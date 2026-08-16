/* Ledger — bill recurrence, reminders and payday overrides */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pd, key } from '../assets/js/dates.js';
import { occurrences, occurrencesWithState, reminderFor,
         paydayFor, isPaydayOn } from '../assets/js/bills.js';

const bill = (over = {}) => ({
  id: 'b1', name: 'Rent', amount: 1200, cadence: 'monthly',
  starts_on: '2026-08-01', ends_on: null,
  reminder_days_before: null, reminder_text: null, ...over,
});

const keys = list => list.map(key);

/* ---------------------------------------------------------------- cadences */

test('monthly repeats on its start date every month', () => {
  const out = occurrences(bill({ starts_on: '2026-08-15' }), pd('2026-08-01'), pd('2026-11-30'));
  assert.deepEqual(keys(out), ['2026-08-15', '2026-09-15', '2026-10-15', '2026-11-15']);
});

test('monthly clamps to short months instead of rolling into the next', () => {
  /* A bill on the 31st has to land in February, not in March. */
  const out = occurrences(bill({ starts_on: '2026-01-31' }), pd('2026-01-01'), pd('2026-05-01'));
  assert.deepEqual(keys(out), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('the clamp does not stick — March goes back to the 31st', () => {
  /* Stepping from the anchor each time rather than from the last occurrence is
     what keeps February from permanently dragging the bill to the 28th. */
  const out = occurrences(bill({ starts_on: '2024-01-31' }), pd('2024-02-01'), pd('2024-04-01'));
  assert.deepEqual(keys(out), ['2024-02-29', '2024-03-31'], 'leap February, then back to the 31st');
});

test('weekly and biweekly follow the start date\'s weekday', () => {
  /* 2026-08-03 is a Monday. */
  assert.deepEqual(
    keys(occurrences(bill({ cadence: 'weekly', starts_on: '2026-08-03' }), pd('2026-08-01'), pd('2026-08-31'))),
    ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']);

  assert.deepEqual(
    keys(occurrences(bill({ cadence: 'biweekly', starts_on: '2026-08-03' }), pd('2026-08-01'), pd('2026-09-30'))),
    ['2026-08-03', '2026-08-17', '2026-08-31', '2026-09-14', '2026-09-28']);
});

test('quarterly and yearly step by months, not by days', () => {
  assert.deepEqual(
    keys(occurrences(bill({ cadence: 'quarterly', starts_on: '2026-02-10' }), pd('2026-01-01'), pd('2027-01-01'))),
    ['2026-02-10', '2026-05-10', '2026-08-10', '2026-11-10']);

  assert.deepEqual(
    keys(occurrences(bill({ cadence: 'yearly', starts_on: '2026-03-20' }), pd('2026-01-01'), pd('2029-01-01'))),
    ['2026-03-20', '2027-03-20', '2028-03-20']);
});

test('a one-off happens once and never again', () => {
  const b = bill({ cadence: 'once', starts_on: '2026-09-12' });
  assert.deepEqual(keys(occurrences(b, pd('2026-01-01'), pd('2030-01-01'))), ['2026-09-12']);
  assert.deepEqual(occurrences(b, pd('2026-10-01'), pd('2030-01-01')), [], 'nothing after it');
});

/* ---------------------------------------------------------------- bounds */

test('nothing appears before the bill starts', () => {
  /* Which is what makes a future-dated bill work without a special case. */
  const b = bill({ starts_on: '2026-12-01' });
  assert.deepEqual(occurrences(b, pd('2026-08-01'), pd('2026-11-30')), []);
  assert.deepEqual(keys(occurrences(b, pd('2026-08-01'), pd('2027-01-31'))),
    ['2026-12-01', '2027-01-01']);
});

test('nothing appears after it ends', () => {
  const b = bill({ starts_on: '2026-08-10', ends_on: '2026-10-10' });
  assert.deepEqual(keys(occurrences(b, pd('2026-08-01'), pd('2027-01-01'))),
    ['2026-08-10', '2026-09-10', '2026-10-10'], 'the end date itself still counts');
});

test('an unknown end date just keeps going', () => {
  const out = occurrences(bill({ ends_on: null }), pd('2030-01-01'), pd('2030-06-30'));
  assert.equal(out.length, 6, 'still running four years later');
});

test('a long-running bill costs no more to query than a new one', () => {
  /* Occurrences are counted forward to the window rather than walked from the
     start date, so a bill running since 2015 does not iterate 130 times. */
  const b = bill({ starts_on: '2015-03-05' });
  const out = occurrences(b, pd('2026-08-01'), pd('2026-10-31'));
  assert.deepEqual(keys(out), ['2026-08-05', '2026-09-05', '2026-10-05']);
});

test('a window that starts exactly on an occurrence includes it', () => {
  assert.deepEqual(
    keys(occurrences(bill({ starts_on: '2026-08-15' }), pd('2026-09-15'), pd('2026-09-15'))),
    ['2026-09-15']);
});

/* ---------------------------------------------------------------- reminders */

test('a reminder lands the given number of days before the bill', () => {
  const b = bill({ reminder_days_before: 3, reminder_text: 'Move money to checking' });
  const r = reminderFor(b, pd('2026-09-15'));
  assert.equal(key(r.date), '2026-09-12');
  assert.equal(r.text, 'Move money to checking');
  assert.equal(key(r.dueDate), '2026-09-15');
});

test('a bill without a reminder has none', () => {
  assert.equal(reminderFor(bill(), pd('2026-09-15')), null);
});

test('reminders carry a default wording rather than appearing blank', () => {
  const r = reminderFor(bill({ reminder_days_before: 2 }), pd('2026-09-15'));
  assert.match(r.text, /funds/);
});

test('a reminder disappears with the bill that owns it', () => {
  /* Derived from occurrences, so an ended bill has no occurrence and therefore
     no reminder — nothing to clean up separately. */
  const b = bill({ starts_on: '2026-08-10', ends_on: '2026-09-10', reminder_days_before: 3 });
  const after = occurrences(b, pd('2026-10-01'), pd('2026-12-31'));
  assert.deepEqual(after, []);
  assert.deepEqual(after.map(d => reminderFor(b, d)), []);
});

/* ---------------------------------------------------------------- state */

test('an untouched occurrence takes the bill\'s amount and is unpaid', () => {
  const out = occurrencesWithState(bill(), [], pd('2026-08-01'), pd('2026-09-30'));
  assert.equal(out.length, 2);
  assert.equal(out[0].amount, 1200);
  assert.equal(out[0].paid, false);
  assert.equal(out[0].instance, null);
});

test('a touched occurrence takes its own amount and paid state', () => {
  const instances = [
    { id: 'i1', bill_id: 'b1', due_date: '2026-09-01', amount: 1250, paid_at: '2026-09-01', reminder_done_at: null },
  ];
  const out = occurrencesWithState(bill(), instances, pd('2026-08-01'), pd('2026-09-30'));
  const sept = out.find(o => o.dateKey === '2026-09-01');
  assert.equal(sept.amount, 1250, 'the edited figure wins');
  assert.equal(sept.paid, true);
  assert.equal(out.find(o => o.dateKey === '2026-08-01').amount, 1200, 'others are untouched');
});

test('instances belonging to another bill are ignored', () => {
  const out = occurrencesWithState(bill(), [
    { id: 'x', bill_id: 'OTHER', due_date: '2026-08-01', amount: 9999, paid_at: '2026-08-01' },
  ], pd('2026-08-01'), pd('2026-08-31'));
  assert.equal(out[0].amount, 1200);
  assert.equal(out[0].paid, false);
});

/* ---------------------------------------------------------------- payday */

test('payday is Thursday by default', () => {
  /* 2026-08-17 is a Monday. */
  assert.equal(key(paydayFor(pd('2026-08-17'), [])), '2026-08-20');
  assert.equal(isPaydayOn(pd('2026-08-20'), []), true);
  assert.equal(isPaydayOn(pd('2026-08-21'), []), false);
});

test('an override moves that one week to Friday', () => {
  const overrides = [{ on_date: '2026-08-21' }];
  assert.equal(key(paydayFor(pd('2026-08-17'), overrides)), '2026-08-21');
  assert.equal(isPaydayOn(pd('2026-08-21'), overrides), true);
  assert.equal(isPaydayOn(pd('2026-08-20'), overrides), false, 'Thursday stops being payday');
});

test('an override affects only its own week', () => {
  const overrides = [{ on_date: '2026-08-21' }];
  assert.equal(isPaydayOn(pd('2026-08-27'), overrides), true, 'the next Thursday is unaffected');
  assert.equal(isPaydayOn(pd('2026-08-13'), overrides), true, 'and the previous one');
});

test('an override can move payday earlier in the week too', () => {
  const overrides = [{ on_date: '2026-08-19' }];   // Wednesday
  assert.equal(isPaydayOn(pd('2026-08-19'), overrides), true);
  assert.equal(isPaydayOn(pd('2026-08-20'), overrides), false);
});
