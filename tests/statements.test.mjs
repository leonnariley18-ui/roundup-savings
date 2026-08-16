/* Ledger — statement prediction and ranking tests
 *
 *   node --test tests/*.test.mjs
 *
 * The cases named in the spec's "testing worth writing" section, plus the
 * transitivity property that an earlier comparator failed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pd, key } from '../assets/js/dates.js';
import { analyse, predictClose, calc, calibration } from '../assets/js/statements.js';
import { rewardFor, blendedRate, scoreOf, rankCards, effectivePct } from '../assets/js/ranking.js';

const card = (over = {}) => ({
  id: 'c1', name: 'Test Card', close_day: 17, due_day: 10,
  credit_limit: 3000, current_balance: 0, apr: 20, cap_limit: null,
  cap_blown: false, reported_note: null, ...over,
});

/* ---------------------------------------------------------------- patterns */

test('Real Rewards reports a 28-day cycle, not a fixed day', () => {
  /* The card's real observations. Jun 18 -> Jul 16 is 28 days, and the two
     days-of-month differ — reading this as a fixed day would put every future
     close on the wrong date, drifting further each month. */
  const a = analyse(['2026-07-16', '2026-06-18']);
  assert.equal(a.kind, 'cycle');
  assert.equal(a.gap, 28);
  assert.match(a.pattern, /every 28 days/);
  assert.equal(a.confirmed, false, 'two observations is likely, not confirmed');
  assert.equal(a.conf, 'likely');
});

test('same day-of-month twice is a fixed day', () => {
  const a = analyse(['2026-07-16', '2026-06-16']);
  assert.equal(a.kind, 'day');
  assert.match(a.pattern, /closes the 16th/);
});

test('three consistent closes confirm a card', () => {
  const a = analyse(['2026-07-16', '2026-06-16', '2026-05-16']);
  assert.equal(a.confirmed, true);
  assert.equal(a.label, 'Confirmed');
  assert.equal(a.conf, 'ok');
});

test('a cycle tolerates a one-day wobble but not more', () => {
  /* Issuers shift off weekends without the cycle having changed. */
  assert.equal(analyse(['2026-08-13', '2026-07-16', '2026-06-18']).kind, 'cycle');
  assert.equal(analyse(['2026-09-01', '2026-07-16', '2026-06-18']).kind, 'mixed');
});

test('inconsistent observations are reported as such, not smoothed over', () => {
  const a = analyse(['2026-07-03', '2026-06-19']);
  assert.equal(a.kind, 'mixed');
  assert.equal(a.label, 'Inconsistent');
  assert.equal(a.confirmed, false);
});

test('fewer than two observations cannot show a pattern', () => {
  assert.equal(analyse([]).kind, null);
  assert.equal(analyse([]).label, '0 of 3');
  assert.equal(analyse(['2026-07-16']).kind, null);
  assert.equal(analyse(['2026-07-16']).label, '1 of 3');
});

test('duplicate observations do not fake a pattern', () => {
  const a = analyse(['2026-07-16', '2026-07-16']);
  assert.equal(a.n, 1, 'deduplicated');
  assert.equal(a.kind, null);
});

/* ---------------------------------------------------------------- prediction */

test('a cycle predicts forward from the last observation', () => {
  const c = card({ close_day: 17 });
  const obs = ['2026-07-16', '2026-06-18'];
  /* 28 days after Jul 16 is Aug 13 — not the 17th that close_day claims. */
  assert.equal(key(predictClose(c, obs, pd('2026-08-01')).date), '2026-08-13');
});

test('a cycle rolls forward past the reference date', () => {
  const c = card();
  const obs = ['2026-07-16', '2026-06-18'];
  assert.equal(key(predictClose(c, obs, pd('2026-08-20')).date), '2026-09-10');
  assert.equal(key(predictClose(c, obs, pd('2026-10-01')).date), '2026-10-08');
});

test('with no observations it falls back to the entered day, and says so', () => {
  const p = predictClose(card({ close_day: 17 }), [], pd('2026-08-11'));
  assert.equal(key(p.date), '2026-08-17');
  assert.equal(p.certain, false);
  assert.match(p.why, /not yet observed/);
});

test('inconsistent observations fall back to the entered day and are flagged', () => {
  const p = predictClose(card({ close_day: 17 }), ['2026-07-03', '2026-06-19'], pd('2026-08-11'));
  assert.equal(key(p.date), '2026-08-17');
  assert.equal(p.certain, false);
  assert.match(p.why, /disagree/);
});

test('a confirmed card predicts with certainty', () => {
  const p = predictClose(card({ close_day: 16 }), ['2026-07-16', '2026-06-16', '2026-05-16'], pd('2026-08-01'));
  assert.equal(p.certain, true);
  assert.equal(p.why, null);
});

/* -------------------------------------------------- prediction from a date */

test('the same card scrubbed to three dates gives three different floats', () => {
  /* The heart of the date scrubber: float shrinks as a close approaches, then
     jumps when it passes. A card that just closed is usually the right one. */
  const c = card({ close_day: 17, due_day: 10 });
  const f = d => calc(c, [], pd(d)).float;

  const aug01 = f('2026-08-01');
  const aug16 = f('2026-08-16');
  const aug18 = f('2026-08-18');

  assert.ok(aug01 > aug16, 'float shrinks as the close approaches');
  assert.ok(aug18 > aug01, 'and jumps once the close has passed');
  assert.equal(new Set([aug01, aug16, aug18]).size, 3, 'three distinct figures');
});

test('float spans close to due date, crossing the month end', () => {
  const t = calc(card({ close_day: 17, due_day: 10 }), [], pd('2026-08-11'));
  assert.equal(key(t.close), '2026-08-17');
  assert.equal(key(t.due), '2026-09-10');
  assert.equal(t.daysToClose, 6);
  assert.equal(t.float, 30);
});

test('utilization is a percentage of the limit', () => {
  assert.equal(calc(card({ credit_limit: 1000, current_balance: 400 }), [], pd('2026-08-11')).util, 40);
  assert.equal(calc(card({ credit_limit: 0, current_balance: 400 }), [], pd('2026-08-11')).util, 0, 'no divide by zero');
});

/* ---------------------------------------------------------------- rewards */

test('points convert at 1 cent, so 3x reads as 3%', () => {
  assert.equal(effectivePct(3, 'points'), 3);
  assert.equal(effectivePct(2, 'pct'), 2);
});

test('an explicit category beats the base rate', () => {
  const rewards = [
    { category: null, value: 1, unit: 'pct' },
    { category: 'dining', value: 2, unit: 'pct' },
  ];
  assert.equal(rewardFor(card(), rewards, null, 'dining').pct, 2);
  assert.equal(rewardFor(card(), rewards, null, 'gas').pct, 1, 'falls back to base');
});

test('a card with no reward rows earns nothing and is marked offers-only', () => {
  const r = rewardFor(card(), [], null, 'dining');
  assert.equal(r.pct, 0);
  assert.equal(r.offersOnly, true);
  assert.equal(r.text, '—');
});

test("BofA's chosen category pays 3% and is flagged as the user's pick", () => {
  const rewards = [{ category: null, value: 1, unit: 'pct' }];
  const r = rewardFor(card({ cap_limit: 2500 }), rewards, 'online', 'online');
  assert.equal(r.pct, 3);
  assert.equal(r.chosen, true);
});

test('switching the chosen category moves the 3% with it', () => {
  const rewards = [{ category: null, value: 1, unit: 'pct' }];
  const c = card({ cap_limit: 2500 });
  assert.equal(rewardFor(c, rewards, 'online', 'dining').pct, 1, 'not chosen -> base');
  assert.equal(rewardFor(c, rewards, 'dining', 'dining').pct, 3, 'chosen -> 3%');
});

/* ---------------------------------------------------------------- the cap */

test('$300 at 2% with $2,400 of a $2,500 cap used gives 1.33%', () => {
  /* The spec's worked example. $100 of the purchase earns 2%, the remaining
     $200 earns the 1% base: (100*2 + 200*1) / 300 = 1.333... */
  const r = blendedRate(2, 1, 300, 2500, 2400);
  assert.equal(r.pct.toFixed(2), '1.33');
  assert.equal(r.capHit, true);
  assert.equal(r.capLeft, 100);
});

test('a purchase inside the cap earns the full bonus', () => {
  const r = blendedRate(3, 1, 200, 2500, 0);
  assert.equal(r.pct, 3);
  assert.equal(r.capHit, false);
});

test('a blown cap drops everything to the base rate', () => {
  const r = blendedRate(3, 1, 200, 2500, 2500);
  assert.equal(r.pct, 1);
  assert.equal(r.capHit, true);
});

test('the cap checkbox drops the chosen category to base', () => {
  const rewards = [{ category: null, value: 1, unit: 'pct' }];
  const blown = card({ cap_limit: 2500, cap_blown: true });
  assert.equal(rewardFor(blown, rewards, 'online', 'online', 200).pct, 1);
});

test('with no amount given the cap cannot be applied', () => {
  /* Amount is optional. Without it there is nothing to compare to the cap, so
     the nominal rate stands — which is why an amount is required only for a
     capped BofA purchase. */
  const r = blendedRate(3, 1, 0, 2500, 0);
  assert.equal(r.pct, 3);
});

/* ---------------------------------------------------------------- ranking */

test('a card carrying any balance is excluded, not merely penalised', () => {
  const cards = [card({ id: 'a', name: 'Clean' }), card({ id: 'b', name: 'Carrying', current_balance: 38 })];
  const r = rankCards({
    cards, rewardsByCard: { a: [{ category: null, value: 1, unit: 'pct' }], b: [{ category: null, value: 5, unit: 'pct' }] },
    choiceByCard: {}, closesByCard: {}, category: 'dining', on: pd('2026-08-11'),
  });
  assert.equal(r.best.card.id, 'a', 'the 5% card is excluded despite paying more');
  assert.equal(r.eligible.length, 1);
  assert.equal(r.rows.length, 2, 'still shown in the table');
  assert.equal(r.rows[1].carrying, true);
});

test('utilization over 30% pushes a card down', () => {
  const hi = scoreOf({ pct: 3, float: 30, util: 40, certain: true });
  const lo = scoreOf({ pct: 3, float: 30, util: 10, certain: true });
  assert.equal(lo - hi, 2);
});

test('an unconfirmed close date costs a small amount', () => {
  const a = scoreOf({ pct: 2, float: 30, util: 0, certain: true });
  const b = scoreOf({ pct: 2, float: 30, util: 0, certain: false });
  assert.ok(Math.abs((a - b) - 0.15) < 1e-9);
});

test('float is worth up to 1.2 points across 58 days', () => {
  const none = scoreOf({ pct: 0, float: 0, util: 0, certain: true });
  const full = scoreOf({ pct: 0, float: 58, util: 0, certain: true });
  assert.equal(none, 0);
  assert.ok(Math.abs(full - 1.2) < 1e-9);
});

test('ranking is transitive across many random cards', () => {
  /* The property the old comparator broke. With one additive score per card,
     ordering cannot contradict itself — this asserts it holds rather than
     trusting that it must. */
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (let trial = 0; trial < 200; trial++) {
    const scored = Array.from({ length: 6 }, () => scoreOf({
      pct: Math.round(rand() * 5 * 100) / 100,
      float: Math.round(rand() * 58),
      util: Math.round(rand() * 60),
      certain: rand() > 0.5,
    }));

    for (let i = 0; i < scored.length; i++)
      for (let j = 0; j < scored.length; j++)
        for (let k = 0; k < scored.length; k++)
          if (scored[i] >= scored[j] && scored[j] >= scored[k])
            assert.ok(scored[i] >= scored[k], 'transitivity violated');
  }
});

/* ---------------------------------------------------------------- calibration */

test('calibration counts progress and lists what is blocking it', () => {
  const cards = [
    card({ id: 'a', name: 'A', apr: 20 }),
    card({ id: 'b', name: 'B', apr: null }),
    card({ id: 'c', name: 'C', apr: 25, reported_note: 'closes 15th-19th' }),
  ];
  const st = calibration(cards, {
    a: ['2026-07-16', '2026-06-16', '2026-05-16'],
    b: [],
    c: ['2026-07-03', '2026-06-19'],
  });

  assert.equal(st.total, 9);
  assert.equal(st.logged, 5, '3 capped + 0 + 2');
  assert.equal(st.confirmed, 1);
  assert.equal(st.done, false);
  assert.ok(st.gaps.some(g => g.t === 'apr' && g.card.id === 'b'));
  assert.ok(st.gaps.some(g => g.t === 'mixed' && g.card.id === 'c'));
  assert.ok(st.gaps.some(g => g.t === 'note' && g.card.id === 'c'));
});

test('calibration completes only when every card is confirmed and every APR known', () => {
  const cards = [card({ id: 'a', apr: 20 })];
  const closes = { a: ['2026-07-16', '2026-06-16', '2026-05-16'] };
  assert.equal(calibration(cards, closes).done, true);
  assert.equal(calibration([card({ id: 'a', apr: null })], closes).done, false);
});

test('removing an observation re-derives the pattern', () => {
  /* A mistyped date must be recoverable — the prediction is derived on read,
     never stored, so dropping the row is the whole undo. */
  const three = ['2026-07-16', '2026-06-16', '2026-05-16'];
  assert.equal(analyse(three).confirmed, true);
  assert.equal(analyse(three.slice(1)).confirmed, false);
  assert.equal(analyse(three.slice(1)).label, '2 of 3');
});

test('an implausible gap is not a cycle — two dates always share one gap', () => {
  /* Two observations produce exactly one gap, and one gap is trivially
     consistent with itself, so without a plausibility check any pair of dates
     would be read as a cycle. A fortnight apart is a typo, not a billing cycle,
     and must land in "keep logging" rather than in a confident prediction. */
  assert.equal(analyse(['2026-07-03', '2026-06-19']).kind, 'mixed', '14 days is not a cycle');
  assert.equal(analyse(['2026-08-20', '2026-06-18']).kind, 'mixed', '63 days is not a cycle');
  assert.equal(analyse(['2026-07-16', '2026-06-18']).kind, 'cycle', '28 days is');
  assert.equal(analyse(['2026-07-20', '2026-06-18']).kind, 'cycle', '32 days is');
});

test('an implausible cycle does not predict, it falls back and flags', () => {
  const p = predictClose(card({ close_day: 17 }), ['2026-07-03', '2026-06-19'], pd('2026-08-11'));
  assert.equal(key(p.date), '2026-08-17', 'uses the entered day, not a 14-day projection');
  assert.equal(p.certain, false);
});
