/* Ledger — statement close prediction
 *
 * The one function both Which card and Statements read. An earlier prototype
 * predicted dates in two places and they drifted, so this file is the only
 * thing in the app that decides when a card closes.
 *
 * No DOM and no database — it takes rows and returns findings, which is what
 * makes it testable and what lets an Edge Function reuse it later.
 *
 * Most issuers close on a fixed CYCLE LENGTH, not a fixed calendar day. A card
 * that closed on the 18th and then the 16th has not moved erratically; it is on
 * a 28-day cycle and the date drifts every month. Treating that as a fixed day
 * produces float figures that are wrong by days, in the direction that costs
 * money.
 */

import { NEEDED } from './config.js';
import { pd, key, ordinal, nextDay, daysBetween } from './dates.js';

/* Reads a card's observed closes and reports the pattern, if there is one.
 * `observations` is an array of 'YYYY-MM-DD' strings in any order. */
export function analyse(observations = []) {
  const obs = [...new Set(observations)].map(pd).sort((a, b) => b - a);  // newest first
  const n = obs.length;

  if (!n) {
    return { conf: 'no', label: '0 of ' + NEEDED, pattern: null, kind: null,
             obs, days: [], gap: null, n: 0, left: NEEDED, confirmed: false };
  }

  const days = obs.map(d => d.getDate());
  const sameDay = days.every(d => d === days[0]);

  const gaps = [];
  for (let i = 0; i < n - 1; i++) gaps.push(daysBetween(obs[i + 1], obs[i]));
  /* ±1 day of slack: issuers shift off weekends and holidays without the
     underlying cycle having changed. */
  const consistentGaps = gaps.length > 0 && gaps.every(g => Math.abs(g - gaps[0]) <= 1);

  /* A statement cycle has to be roughly a month. This guard is not in the spec,
     and it earns its place because of how two observations behave: two dates
     produce exactly one gap, and one gap is always consistent with itself, so
     without a plausibility check ANY pair of dates reads as a cycle. Two dates
     a fortnight apart would be reported as a confident 14-day cycle and every
     future close predicted from it — when the real explanation is almost always
     a typo. Out-of-range gaps fall through to 'inconsistent', which is exactly
     the state that asks the user to keep logging. */
  const PLAUSIBLE_CYCLE = { min: 20, max: 45 };
  const sameGap = consistentGaps &&
    gaps[0] >= PLAUSIBLE_CYCLE.min && gaps[0] <= PLAUSIBLE_CYCLE.max;

  let pattern = null, kind = null;
  if (n >= 2 && sameDay) {
    kind = 'day';
    pattern = 'Fixed day — closes the ' + days[0] + ordinal(days[0]) + ' each month';
  } else if (n >= 2 && sameGap) {
    kind = 'cycle';
    pattern = 'Fixed cycle — every ' + gaps[0] + ' days, so the date drifts';
  } else if (n >= 2) {
    kind = 'mixed';
    pattern = 'Not consistent yet — seen on the ' + Math.min(...days) + ordinal(Math.min(...days)) +
              ' and the ' + Math.max(...days) + ordinal(Math.max(...days));
  }

  const consistent = kind === 'day' || kind === 'cycle';
  const confirmed = n >= NEEDED && consistent;

  return {
    conf: confirmed ? 'ok' : (n >= 2 && consistent) ? 'likely' : kind === 'mixed' ? 'mixed' : 'est',
    label: confirmed ? 'Confirmed' : kind === 'mixed' ? 'Inconsistent' : n + ' of ' + NEEDED,
    pattern, kind, obs, days,
    gap: sameGap ? gaps[0] : null,
    n, left: Math.max(0, NEEDED - n), confirmed,
  };
}

/* When this card next closes, at or after `from`.
 *
 * Never writes anything. The predicted date is derived on every read, so
 * removing a mistyped observation re-derives it immediately — which is why
 * statement_closes must only ever hold dates that were actually observed. */
export function predictClose(card, observations, from) {
  const base = from;
  const a = analyse(observations);

  if (a.kind === 'cycle' && a.gap) {
    let d = new Date(a.obs[0].getTime() + a.gap * 864e5);
    while (d < base) d = new Date(d.getTime() + a.gap * 864e5);
    return { date: d, certain: a.confirmed,
             why: a.confirmed ? null : 'projected from a ' + a.gap + '-day cycle' };
  }

  if (a.kind === 'mixed') {
    return { date: nextDay(base, card.close_day), certain: false,
             why: 'observed dates disagree' };
  }

  return {
    date: nextDay(base, card.close_day),
    certain: !!a.confirmed,
    why: a.confirmed ? null
       : a.n ? 'only ' + a.n + ' statement' + (a.n > 1 ? 's' : '') + ' logged'
             : 'from what you entered, not yet observed',
  };
}

/* Close date, due date, and the float between now and the money leaving.
 *
 * float = days to close + the grace period to the due date. Buying the day
 * after a card closes gives the longest runway, which is the whole reason the
 * Which card tab exists. */
export function calc(card, observations, from) {
  const p = predictClose(card, observations, from);
  const close = p.date;
  const due = nextDay(close, card.due_day);
  const limit = Number(card.credit_limit) || 0;
  const balance = Number(card.current_balance) || 0;

  return {
    close, due,
    certain: p.certain,
    why: p.why,
    daysToClose: daysBetween(from, close),
    float: daysBetween(from, due),
    util: limit ? (balance / limit) * 100 : 0,
  };
}

/* Progress toward every card having a known pattern and a known APR. */
export function calibration(cards, closesByCard) {
  const per = cards.map(c => ({ card: c, a: analyse(closesByCard[c.id] || []) }));
  const logged = per.reduce((n, x) => n + Math.min(NEEDED, x.a.n), 0);
  const confirmed = per.filter(x => x.a.confirmed).length;

  const gaps = [];
  cards.forEach(c => { if (c.apr == null) gaps.push({ t: 'apr', card: c, txt: 'APR not set' }); });
  per.forEach(x => { if (x.a.kind === 'mixed') gaps.push({ t: 'mixed', card: x.card, txt: 'closing dates disagree — keep logging' }); });
  cards.forEach(c => { if (c.reported_note) gaps.push({ t: 'note', card: c, txt: c.reported_note }); });

  return {
    per, logged, confirmed,
    total: cards.length * NEEDED,
    gaps,
    done: cards.length > 0 && confirmed === cards.length && !cards.some(c => c.apr == null),
  };
}
