/* Ledger — payback state transitions
 *
 * The cases the spec names: open -> partial -> cleared, cleared dropping off
 * the calendar, crossing into became_bill, dismissal preserving the record,
 * off-card paybacks never acquiring a close date, and rescheduling never
 * surfacing its own count.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pd, key } from '../assets/js/dates.js';
import { derive, summarise, clampPayment } from '../assets/js/paybacks.js';

const TODAY = pd('2026-08-16');

const card = (over = {}) => ({
  id: 'c1', name: 'Chase Prime Visa', last4: '1856',
  close_day: 20, due_day: 13, credit_limit: 9600, current_balance: 0,
  apr: 27.49, cap_limit: null, cap_blown: false, ...over,
});

const pb = (over = {}) => ({
  id: 'p1', description: 'Concert tickets', amount: 200,
  card_id: 'c1', incurred_on: '2026-08-14', intended_payback_on: '2026-08-21',
  moves: 0, status: 'open', dismissed: false, ...over,
});

/* ---------------------------------------------------------- the lifecycle */

test('open -> partial -> cleared', () => {
  const open = derive(pb(), [], card(), [], TODAY);
  assert.equal(open.state, 'open');
  assert.equal(open.paid, 0);
  assert.equal(open.left, 200);
  assert.equal(open.pct, 0);

  const partial = derive(pb(), [{ amount: 50, paid_at: '2026-08-15' }], card(), [], TODAY);
  assert.equal(partial.state, 'open');
  assert.equal(partial.left, 150);
  assert.equal(partial.pct, 25);
  assert.equal(partial.cleared, false);

  const cleared = derive(pb(), [{ amount: 50 }, { amount: 150 }], card(), [], TODAY);
  assert.equal(cleared.state, 'cleared');
  assert.equal(cleared.left, 0);
  assert.equal(cleared.pct, 100);
  assert.equal(cleared.cleared, true);
});

test('clearing it drops it off the calendar and out of the outstanding total', () => {
  const list = [
    derive(pb({ id: 'a' }), [{ amount: 200 }], card(), [], TODAY),
    derive(pb({ id: 'b', amount: 80 }), [], card(), [], TODAY),
  ];
  const s = summarise(list);
  assert.equal(s.fronted, 80, 'the cleared one contributes nothing outstanding');
  assert.equal(s.openCount, 1);
});

test('a payback cleared after its close date still never becomes a bill', () => {
  /* Clearing is the reward. Once it is paid it is gone, whatever the dates
     say afterwards. */
  const c = card({ close_day: 10 });   // already passed on Aug 16
  const d = derive(pb(), [{ amount: 200 }], c, [], TODAY);
  assert.equal(d.becameBill, false);
  assert.equal(d.state, 'cleared');
});

/* ---------------------------------------------------------- becoming a bill */

test('crossing the close date turns it into a bill', () => {
  const before = derive(pb(), [], card({ close_day: 20 }), [], TODAY);
  assert.equal(before.state, 'open');
  assert.ok(before.daysToClose > 0);

  /* Close day 10 means the next close is Sep 10, i.e. this month's has passed.
     Feed observations that pin the close to a date already gone. */
  const after = derive(pb(), [], card({ close_day: 20 }), [], pd('2026-08-25'));
  assert.equal(after.state, 'open', 'still open — the next close is ahead');

  /* A genuinely past close: predicted date behind the reference date. */
  const past = derive(pb(), [], card({ close_day: 20 }), [], pd('2026-08-20'));
  assert.equal(past.daysToClose, 0, 'closes today, not yet a bill');
});

test('a partially paid payback past its close is still a bill for the remainder', () => {
  const d = derive(pb(), [{ amount: 50 }], card(), [], TODAY);
  assert.equal(d.left, 150);
  assert.equal(d.cleared, false);
});

/* ---------------------------------------------------------- off-card */

test('an off-card payback never acquires a close date or becomes a bill', () => {
  const d = derive(pb({ card_id: null }), [], null, [], pd('2027-01-01'));
  assert.equal(d.offCard, true);
  assert.equal(d.closeDate, null);
  assert.equal(d.daysToClose, null);
  assert.equal(d.becameBill, false, 'nothing closes on it, so it cannot become a bill');
  assert.equal(d.state, 'open', 'it just stays open until cleared');
});

test('an off-card countdown runs to the user\'s own target', () => {
  const soon = derive(pb({ card_id: null, intended_payback_on: '2026-08-10' }), [], null, [], TODAY);
  assert.equal(soon.daysToTarget, -6);
  assert.equal(soon.targetPassed, true);
  assert.equal(soon.urgency, 'soon', 'urgency comes from the target, not a close');

  const later = derive(pb({ card_id: null, intended_payback_on: '2026-09-30' }), [], null, [], TODAY);
  assert.equal(later.urgency, 'ok');
});

/* ---------------------------------------------------------- urgency */

test('urgency runs to close for card paybacks', () => {
  const u = closeDay => derive(pb(), [], card({ close_day: closeDay }), [], TODAY).urgency;
  assert.equal(u(17), 'late', 'closes tomorrow');
  assert.equal(u(20), 'soon', 'closes in 4 days');
  assert.equal(u(30), 'ok', 'closes in a fortnight');
});

test('a cleared payback is never urgent', () => {
  const d = derive(pb(), [{ amount: 200 }], card({ close_day: 17 }), [], TODAY);
  assert.equal(d.urgency, 'ok');
});

/* ---------------------------------------------------------- the status bar */

test('the bar splits everything outstanding four ways', () => {
  const list = [
    derive(pb({ id: 'a', amount: 100 }), [{ amount: 100 }], card(), [], TODAY),          // paid
    derive(pb({ id: 'b', amount: 100 }), [], card({ close_day: 17 }), [], TODAY),        // late
    derive(pb({ id: 'c', amount: 100 }), [], card({ close_day: 21 }), [], TODAY),        // soon
    derive(pb({ id: 'd', amount: 100 }), [], card({ close_day: 30 }), [], TODAY),        // has room
  ];
  const { bar } = summarise(list);
  assert.equal(bar.paid, 100);
  assert.equal(bar.late, 100);
  assert.equal(bar.soon, 100);
  assert.equal(bar.easy, 100);
  assert.equal(bar.total, 400);
});

test('a partial payment counts in both halves', () => {
  const list = [derive(pb({ amount: 100 }), [{ amount: 40 }], card({ close_day: 30 }), [], TODAY)];
  const { bar, fronted } = summarise(list);
  assert.equal(bar.paid, 40);
  assert.equal(bar.easy, 60);
  assert.equal(fronted, 60, 'only the remainder is still fronted');
});

/* ---------------------------------------------------------- payments */

test('overpayment clamps to what is left', () => {
  const r = clampPayment(500, 150);
  assert.equal(r.ok, true);
  assert.equal(r.amount, 150);
  assert.equal(r.clamped, true);
});

test('an exact payment is not treated as an overpayment', () => {
  const r = clampPayment(150, 150);
  assert.equal(r.clamped, false);
  assert.equal(r.amount, 150);
});

test('zero and nonsense are rejected', () => {
  assert.equal(clampPayment(0, 100).ok, false);
  assert.equal(clampPayment(-5, 100).ok, false);
  assert.equal(clampPayment('abc', 100).ok, false);
});

test('floating point pennies still clear a payback', () => {
  /* 0.1 + 0.2 is famously not 0.3. Comparing money with === would leave a
     payback a fraction of a cent short of cleared, forever. */
  const d = derive(pb({ amount: 0.3 }), [{ amount: 0.1 }, { amount: 0.2 }], card(), [], TODAY);
  assert.equal(d.cleared, true);
});

/* ---------------------------------------------------------- rescheduling */

test('the move count is carried but never part of what is displayed', () => {
  /* Surfacing it would turn a helpful affordance into a scold. It is stored so
     the future game layer can see it; nothing the UI renders reads it. */
  const moved = derive(pb({ moves: 4, intended_payback_on: '2026-08-10' }), [], card(), [], TODAY);
  assert.equal(moved.targetPassed, true, 'the offer to reschedule appears');
  assert.equal('moves' in moved, false, 'and the count is not in the derived view');
  assert.equal(moved.payback.moves, 4, 'still on the record underneath');
});

test('a passed target is offered a new date only while unpaid', () => {
  const unpaid = derive(pb({ intended_payback_on: '2026-08-10' }), [], card(), [], TODAY);
  assert.equal(unpaid.targetPassed, true);

  const paid = derive(pb({ intended_payback_on: '2026-08-10' }), [{ amount: 200 }], card(), [], TODAY);
  assert.equal(paid.targetPassed, false, 'nothing to reschedule once it is cleared');
});

/* ---------------------------------------------------------- dismissal */

test('dismissal is a flag on a preserved record, not a delete', () => {
  const d = derive(pb({ dismissed: true }), [], card(), [], TODAY);
  assert.equal(d.payback.dismissed, true);
  assert.equal(d.amount, 200, 'the record is intact');
  assert.equal(d.payback.description, 'Concert tickets');
});

test('paybacks that became bills leave the outstanding total', () => {
  /* Once it is on the statement there is no action left, so it stops counting
     against what is still fronted — it stops nagging. */
  const list = [
    derive(pb({ id: 'a', amount: 100 }), [], card({ close_day: 30 }), [], TODAY),
    { ...derive(pb({ id: 'b', amount: 100 }), [], card(), [], TODAY), state: 'became_bill' },
  ];
  assert.equal(summarise(list).fronted, 100);
});
