/* Ledger — the one event model
 *
 * Everything that happens on a date comes from here, in one shape. An earlier
 * prototype built the calendar's markers, the week list and the day modal from
 * three separate pieces of code, and they drifted — a marker would appear on
 * the grid with nothing behind it in the day view. One function, every consumer.
 *
 * The day modal filters `note` out because it renders notes in its own section.
 * Everything else consumes this unfiltered.
 *
 * No DOM, no database.
 */

import { key, pd, add, daysBetween } from './dates.js';
import { predictClose, analyse } from './statements.js';
import { derive } from './paybacks.js';
import { occurrencesWithState } from './bills.js';

/* Sort order within a single day. Bills first because they are the money
 * actually leaving; notes last because they are commentary on the rest. */
export const ORDER = { bill: 0, remind: 1, close: 2, pbk: 3, pbwant: 4, roundup: 5, note: 6 };

/* Every predicted close for one card that falls inside a range.
 *
 * Walks forward from before the range rather than jumping, because a fixed
 * cycle drifts — you cannot ask "which day of month" and get the right answer
 * for a card that moves a day or two each time. */
function closesForCard(card, observations, from, to) {
  const out = [];
  const a = analyse(observations);
  let cur = predictClose(card, observations, add(from, -45)).date;

  for (let i = 0; i < 24 && cur <= to; i++) {
    if (cur >= from) out.push(new Date(cur));
    cur = (a.kind === 'cycle' && a.gap)
      ? new Date(cur.getTime() + a.gap * 864e5)
      : predictClose(card, observations, add(cur, 1)).date;
  }
  return out;
}

/* Builds a date-keyed index once, so a month grid does not recompute
 * predictions for every one of its 42 cells. */
export function buildIndex({ cards = [], closesByCard = {}, paybacks = [], paymentsByPayback = {},
                             notes = [], roundupRuns = [], billInstances = [], bills = [] },
                           from, to, todayDate) {
  const index = {};
  const push = e => (index[e.date] ||= []).push(e);

  /* Occurrences are derived, so a bill entered today is on the calendar for
     2031 immediately and nothing has to be generated ahead. A reminder is
     pulled a few days earlier — it can fall outside the window its bill is in,
     so reminders are gathered over a widened range and then filtered. */
  bills.forEach(bill => {
    const reach = bill.reminder_days_before || 0;
    occurrencesWithState(bill, billInstances, from, add(to, reach)).forEach(occ => {
      if (occ.dateKey >= key(from) && occ.dateKey <= key(to)) {
        push({ type: 'bill', date: occ.dateKey, label: bill.name, sub: bill.category || '',
               amount: occ.amount,
               colour: bill.links_to_debt_id ? 'var(--loan)' : 'var(--accent)',
               ref: { bill, occurrence: occ }, paid: occ.paid,
               isLoan: !!bill.links_to_debt_id, isAuto: !!bill.is_auto });
      }

      /* The reminder exists only because the occurrence does, which is what
         makes it vanish when the bill ends — nothing to clean up. */
      if (occ.reminder) {
        const rk = key(occ.reminder.date);
        if (rk >= key(from) && rk <= key(to)) {
          push({ type: 'remind', date: rk, label: occ.reminder.text,
                 sub: `${bill.name} · ${occ.amount ? '$' + Math.round(occ.amount) : ''} due ${occ.dateKey.slice(8)}${monthAbbr(occ.date)}`,
                 amount: null, colour: 'var(--warn)',
                 ref: { bill, occurrence: occ }, done: occ.reminderDone });
        }
      }
    });
  });

  cards.forEach(card => {
    closesForCard(card, closesByCard[card.id] || [], from, to).forEach(d => {
      const certain = predictClose(card, closesByCard[card.id] || [], add(d, -1)).certain;
      push({ type: 'close', date: key(d), label: card.name,
             sub: 'Statement closes' + (certain ? '' : ' · estimated'),
             amount: null, colour: 'var(--warn)', ref: { card } });
    });
  });

  paybacks.forEach(p => {
    const card = p.card_id ? cards.find(c => c.id === p.card_id) : null;
    const d = derive(p, paymentsByPayback[p.id] || [], card,
                     p.card_id ? (closesByCard[p.card_id] || []) : [], todayDate);

    /* A cleared payback leaves the calendar immediately — both its deadline
       and its target. That is the reward for clearing it. */
    if (d.cleared) return;

    if (!d.offCard && d.closeDate && d.closeDate >= from && d.closeDate <= to) {
      push({ type: 'pbk', date: key(d.closeDate), label: p.description,
             sub: 'Becomes a bill if not cleared', amount: d.left,
             colour: 'var(--alert)', ref: { payback: p } });
    }

    const target = pd(p.intended_payback_on);
    if (target >= from && target <= to) {
      push({ type: 'pbwant', date: p.intended_payback_on, label: p.description,
             sub: 'Your target to clear this', amount: d.left,
             colour: 'var(--pbk)', ref: { payback: p } });
    }
  });

  roundupRuns.forEach(r => {
    if (r.ran_on < key(from) || r.ran_on > key(to)) return;
    push({ type: 'roundup', date: r.ran_on, label: 'Round-up moved',
           sub: 'You swept the spare change', amount: null,
           colour: 'var(--save)', ref: { run: r } });
  });

  notes.forEach(n => {
    if (n.on_date < key(from) || n.on_date > key(to)) return;
    push({ type: 'note', date: n.on_date, label: n.body, sub: 'Note',
           amount: null, colour: 'var(--muted)', ref: { note: n } });
  });

  Object.values(index).forEach(list => list.sort((a, b) => ORDER[a.type] - ORDER[b.type]));
  return index;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthAbbr = d => ' ' + MONTHS[d.getMonth()];

export const eventsOn = (index, k) => index[k] || [];

/* Strictly chronological across the range, with the within-day order held. */
export function eventsBetween(index, from, to) {
  const out = [];
  for (let d = new Date(from); d <= to; d = add(d, 1)) out.push(...eventsOn(index, key(d)));
  return out.sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.type] - ORDER[b.type]);
}
