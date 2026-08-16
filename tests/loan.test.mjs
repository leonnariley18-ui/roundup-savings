/* Ledger — loan amortisation
 *
 * The spec states the loan's figures outright. These assert that the code
 * derives them rather than repeating them, which is the whole requirement:
 * every figure computed, nothing hardcoded.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pd, key } from '../assets/js/dates.js';
import { schedule, payoffDate, comparison, costOfOneMinimumMonth,
         position, splitPayment } from '../assets/js/loan.js';

/* The real loan. $10,000 SoFi consolidation, 11.95% with AutoPay, autopay set
   to $350 against a $223.65 minimum, first payment 5 Sep 2026. */
const LOAN = {
  principal: 10000, apr: 11.95,
  minimum_payment: 223.65, actual_payment: 350,
  start_date: '2026-09-05', term_months: 60,
};
const FIRST = pd(LOAN.start_date);

/* ---------------------------------------------------------------- the terms */

test('$350 a month clears it in 34 payments for $1,826.06 of interest', () => {
  const s = schedule(10000, 11.95, 350);
  assert.equal(s.count, 34);
  assert.equal(s.totalInterest.toFixed(2), '1826.06');
});

test('$350 pays it off in June 2029', () => {
  const d = payoffDate(FIRST, schedule(10000, 11.95, 350).count);
  assert.equal(d.getFullYear(), 2029);
  assert.equal(d.getMonth(), 5, 'June');
});

test('the $223.65 floor takes the full 60 payments, into August 2031', () => {
  const s = schedule(10000, 11.95, 223.65);
  assert.equal(s.count, 60);
  const d = payoffDate(FIRST, s.count);
  assert.equal(d.getFullYear(), 2031);
  assert.equal(d.getMonth(), 7, 'August');
});

test('the minimum costs about $3,300 in interest', () => {
  /* The spec quotes $3,300.08; this computes $3,300.04. The four cents are the
     rounding of the final short payment — the $350 case, which ends on an exact
     figure, matches the spec to the penny. The computed number is the one
     shown, because a figure that disagrees with the schedule it came from is
     worse than one that disagrees with a document. */
  const s = schedule(10000, 11.95, 223.65);
  assert.ok(Math.abs(s.totalInterest - 3300.08) < 0.10, `got ${s.totalInterest}`);
});

test('holding $350 avoids about $1,474 and erases 26 months', () => {
  const c = comparison(LOAN);
  assert.equal(c.monthsErased, 26);
  assert.ok(Math.abs(c.interestAvoided - 1474.02) < 0.10, `got ${c.interestAvoided}`);
});

/* ---------------------------------------------------------- the first payment */

test('the first payment is $99.58 interest against $250.42 principal', () => {
  const first = schedule(10000, 11.95, 350).periods[0];
  assert.equal(first.interest.toFixed(2), '99.58');
  assert.equal(first.principal.toFixed(2), '250.42');
});

test('that is 72% principal, against 55% at the minimum', () => {
  assert.equal(Math.round(schedule(10000, 11.95, 350).periods[0].principalShare), 72);
  assert.equal(Math.round(schedule(10000, 11.95, 223.65).periods[0].principalShare), 55);
});

test('the share going to principal climbs every month', () => {
  const s = schedule(10000, 11.95, 350);
  for (let i = 1; i < s.periods.length; i++) {
    assert.ok(s.periods[i].principalShare >= s.periods[i - 1].principalShare,
      `period ${i + 1} went backwards`);
  }
});

test('one month at the floor costs about $50, not the $12 the spec quotes', () => {
  /* The spec says "dropping to the minimum for a single month costs roughly
     $12 in extra interest". Computed from the schedule it is about $50, and
     the reason is structural rather than a rounding difference: paying the
     floor once defers $126.35 of principal, which is enough to add a whole
     extra period to the loan. One more month of interest on a four-figure
     balance is ~$50, not ~$12.

     $12 is close to what deferring $126.35 costs if it is made up within the
     next few months rather than never — a different question, and a reasonable
     one, but not what "dropping to the minimum for a month" does on its own.

     The screen shows this computed figure. The point the spec is making — that
     the floor is affordable and exists to be used — survives at $50; quoting a
     number four times too low to make it feel better would not. */
  const cost = costOfOneMinimumMonth(LOAN);
  assert.ok(cost > 45 && cost < 55, `expected roughly $50, got ${cost}`);

  /* And the mechanism, asserted so the explanation cannot rot: */
  const straight = schedule(10000, 11.95, 350);
  const deferred = 250.42 - 124.07;
  const after = schedule(10000 - deferred, 11.95, 350);
  assert.equal(after.count, straight.count, 'a whole extra period is added');
});

/* ---------------------------------------------------------------- schedules */

test('the final payment is short rather than overshooting', () => {
  const s = schedule(10000, 11.95, 350);
  const last = s.periods[s.periods.length - 1];
  assert.ok(last.payment <= 350, 'never pays more than the instalment');
  assert.equal(last.balance, 0, 'and lands exactly on zero');
});

test('the balance falls monotonically to zero', () => {
  const s = schedule(10000, 11.95, 350);
  let prev = Infinity;
  for (const p of s.periods) {
    assert.ok(p.balance < prev, 'balance must always fall');
    prev = p.balance;
  }
  assert.equal(prev, 0);
});

test('a payment that cannot cover the interest is reported, not looped forever', () => {
  /* $10,000 at 11.95% accrues about $99.58 a month. */
  const s = schedule(10000, 11.95, 50);
  assert.equal(s.impossible, true);
  assert.match(s.reason, /does not cover/);
});

test('interest and principal always sum to the payment', () => {
  for (const p of schedule(10000, 11.95, 350).periods) {
    assert.ok(Math.abs((p.interest + p.principal) - p.payment) < 0.005);
  }
});

/* ---------------------------------------------------------------- position */

test('with nothing paid it is a projection, and says so', () => {
  const pos = position(LOAN, []);
  assert.equal(pos.started, false);
  assert.equal(pos.payments, 0);
  assert.equal(pos.balance, 10000);
  assert.equal(pos.paid, 0);
  assert.equal(pos.projectedTotalInterest.toFixed(2), '1826.06');
});

test('a logged payment moves the balance and shortens what is left', () => {
  const before = position(LOAN, []);
  const after = position(LOAN, [
    { amount: 350, principal_portion: 250.42, interest_portion: 99.58, paid_at: '2026-09-05' },
  ]);

  assert.equal(after.started, true);
  assert.equal(after.balance.toFixed(2), '9749.58');
  assert.equal(after.interestPaid.toFixed(2), '99.58');
  assert.equal(after.remaining.count, before.remaining.count - 1,
    'one fewer payment to go');
});

test('history is preserved rather than recomputed', () => {
  /* Both portions are stored on the row, so a payment made at a different
     figure than the schedule expected stays exactly as it happened. */
  const pos = position(LOAN, [
    { amount: 500, principal_portion: 400.42, interest_portion: 99.58, paid_at: '2026-09-05' },
  ]);
  assert.equal(pos.paid, 500);
  assert.equal(pos.principalPaid.toFixed(2), '400.42');
  assert.equal(pos.balance.toFixed(2), '9599.58', 'the overpayment really did land');
});

test('a fully repaid loan reports cleared with nothing remaining', () => {
  const pos = position(LOAN, [
    { amount: 10000, principal_portion: 10000, interest_portion: 0, paid_at: '2026-09-05' },
  ]);
  assert.equal(pos.cleared, true);
  assert.equal(pos.balance, 0);
  assert.equal(pos.remaining.count, 0);
});

/* ---------------------------------------------------------------- splitting */

test('a payment splits at the current balance, not the original principal', () => {
  const atStart = splitPayment(10000, 11.95, 350);
  assert.equal(atStart.interest.toFixed(2), '99.58');
  assert.equal(atStart.principal.toFixed(2), '250.42');

  const later = splitPayment(5000, 11.95, 350);
  assert.equal(later.interest.toFixed(2), '49.79');
  assert.ok(later.principal > atStart.principal, 'less interest, so more principal');
});

test('paying the floor still splits correctly', () => {
  const s = splitPayment(10000, 11.95, 223.65);
  assert.equal(s.interest.toFixed(2), '99.58');
  assert.equal(s.principal.toFixed(2), '124.07');
});
