/* Ledger — the one event model
 *
 * The spec's requirement: eventsBetween returns strictly chronological output
 * with the bill / close / payback / target / round-up / note order held within
 * a day. An earlier prototype built these lists separately and they drifted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pd, key } from '../assets/js/dates.js';
import { buildIndex, eventsOn, eventsBetween, ORDER } from '../assets/js/events.js';

const TODAY = pd('2026-08-16');
const FROM = pd('2026-08-01');
const TO = pd('2026-09-30');

const card = (over = {}) => ({
  id: 'c1', name: 'Chase Prime Visa', last4: '1856', close_day: 20, due_day: 13,
  credit_limit: 9600, current_balance: 0, apr: 27.49, cap_limit: null, cap_blown: false, ...over,
});

const dataset = (over = {}) => ({
  cards: [card()],
  closesByCard: {},
  paybacks: [],
  paymentsByPayback: {},
  notes: [],
  roundupRuns: [],
  bills: [],
  billInstances: [],
  ...over,
});

const build = over => buildIndex(dataset(over), FROM, TO, TODAY);

/* ---------------------------------------------------------------- ordering */

test('within a day, events hold the bill/reminder/close/payback/target/roundup/note order', () => {
  /* Everything stacked on one date, deliberately supplied in reverse. */
  const day = '2026-08-20';
  const index = build({
    notes: [{ id: 'n1', on_date: day, body: 'a note' }],
    roundupRuns: [{ id: 'r1', ran_on: day }],
    paybacks: [
      { id: 'p1', description: 'target here', amount: 50, card_id: null,
        incurred_on: '2026-08-01', intended_payback_on: day, moves: 0, dismissed: false },
      { id: 'p2', description: 'deadline here', amount: 80, card_id: 'c1',
        incurred_on: '2026-08-01', intended_payback_on: '2026-09-29', moves: 0, dismissed: false },
    ],
    bills: [{ id: 'b1', name: 'Rent', category: 'Housing', amount: 1200,
              cadence: 'once', starts_on: day, ends_on: null }],
    billInstances: [],
  });

  const types = eventsOn(index, day).map(e => e.type);
  assert.deepEqual(types, ['bill', 'close', 'pbk', 'pbwant', 'roundup', 'note']);
});

test('eventsBetween is strictly chronological across the range', () => {
  const index = build({
    notes: [{ id: 'n1', on_date: '2026-09-05', body: 'later' },
            { id: 'n2', on_date: '2026-08-03', body: 'earlier' }],
    roundupRuns: [{ id: 'r1', ran_on: '2026-08-25' }],
  });

  const dates = eventsBetween(index, FROM, TO).map(e => e.date);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted, 'output is in date order');
});

test('ordering holds across days as well as within them', () => {
  const index = build({
    notes: [{ id: 'n1', on_date: '2026-08-20', body: 'note on close day' }],
  });
  const seq = eventsBetween(index, FROM, TO).map(e => e.date + ':' + e.type);
  const closeIdx = seq.indexOf('2026-08-20:close');
  const noteIdx = seq.indexOf('2026-08-20:note');
  assert.ok(closeIdx >= 0 && noteIdx >= 0);
  assert.ok(closeIdx < noteIdx, 'close precedes note on the same day');
});

/* ---------------------------------------------------------------- closes */

test('a fixed-day card produces one close per month in range', () => {
  const index = build({});
  const closes = eventsBetween(index, FROM, TO).filter(e => e.type === 'close');
  assert.deepEqual(closes.map(e => e.date), ['2026-08-20', '2026-09-20']);
});

test('a rolling cycle drifts rather than repeating a calendar day', () => {
  /* Jun 18 -> Jul 16 is 28 days. The predicted closes must step by 28, not
     land on the same day of the month each time. */
  const index = build({ closesByCard: { c1: ['2026-07-16', '2026-06-18'] } });
  const closes = eventsBetween(index, FROM, TO).filter(e => e.type === 'close').map(e => e.date);
  assert.deepEqual(closes, ['2026-08-13', '2026-09-10']);
  const days = closes.map(d => Number(d.slice(-2)));
  assert.notEqual(days[0], days[1], 'the date drifts');
});

test('an unconfirmed close is marked estimated', () => {
  const index = build({});
  const close = eventsOn(index, '2026-08-20').find(e => e.type === 'close');
  assert.match(close.sub, /estimated/);
});

/* ---------------------------------------------------------------- paybacks */

test('an open payback puts both its deadline and its target on the calendar', () => {
  const index = build({
    paybacks: [{ id: 'p1', description: 'Concert tickets', amount: 200, card_id: 'c1',
                 incurred_on: '2026-08-14', intended_payback_on: '2026-08-21', moves: 0, dismissed: false }],
  });
  const mine = eventsBetween(index, FROM, TO).filter(e => e.ref.payback);
  assert.deepEqual(mine.map(e => `${e.date}:${e.type}`),
    ['2026-08-20:pbk', '2026-08-21:pbwant'],
    'the close comes first, then the date you set');
  assert.equal(mine[0].colour, 'var(--alert)');
  assert.equal(mine[1].colour, 'var(--pbk)');
});

test('clearing a payback drops it off the calendar entirely', () => {
  const pb = { id: 'p1', description: 'Concert tickets', amount: 200, card_id: 'c1',
               incurred_on: '2026-08-14', intended_payback_on: '2026-08-21', moves: 0, dismissed: false };

  const open = build({ paybacks: [pb] });
  assert.equal(eventsBetween(open, FROM, TO).filter(e => e.ref.payback).length, 2);

  const cleared = build({ paybacks: [pb], paymentsByPayback: { p1: [{ amount: 200 }] } });
  assert.equal(eventsBetween(cleared, FROM, TO).filter(e => e.ref.payback).length, 0,
    'neither the deadline nor the target survives being paid');
});

test('an off-card payback contributes a target but never a deadline', () => {
  const index = build({
    paybacks: [{ id: 'p1', description: 'Affirm', amount: 120, card_id: null,
                 incurred_on: '2026-08-01', intended_payback_on: '2026-09-15', moves: 0, dismissed: false }],
  });
  const mine = eventsBetween(index, FROM, TO).filter(e => e.ref.payback);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].type, 'pbwant', 'nothing closes on it, so no deadline marker');
});

test('a partially paid payback shows what is still outstanding', () => {
  const index = build({
    paybacks: [{ id: 'p1', description: 'Concert tickets', amount: 200, card_id: 'c1',
                 incurred_on: '2026-08-14', intended_payback_on: '2026-08-21', moves: 0, dismissed: false }],
    paymentsByPayback: { p1: [{ amount: 50 }] },
  });
  const target = eventsBetween(index, FROM, TO).find(e => e.type === 'pbwant');
  assert.equal(target.amount, 150, 'the remainder, not the original figure');
});

/* ---------------------------------------------------------------- range */

test('nothing outside the requested range is included', () => {
  const index = build({
    notes: [{ id: 'n1', on_date: '2026-07-01', body: 'before' },
            { id: 'n2', on_date: '2026-12-01', body: 'after' },
            { id: 'n3', on_date: '2026-08-10', body: 'inside' }],
  });
  const notes = eventsBetween(index, FROM, TO).filter(e => e.type === 'note');
  assert.deepEqual(notes.map(e => e.label), ['inside']);
});

test('a day with nothing on it returns an empty list, not undefined', () => {
  assert.deepEqual(eventsOn(build({}), '2026-08-02'), []);
});

/* ---------------------------------------------------------------- shape */

test('every event carries the same shape', () => {
  const index = build({
    notes: [{ id: 'n1', on_date: '2026-08-10', body: 'x' }],
    roundupRuns: [{ id: 'r1', ran_on: '2026-08-11' }],
    paybacks: [{ id: 'p1', description: 'y', amount: 10, card_id: 'c1',
                 incurred_on: '2026-08-01', intended_payback_on: '2026-08-12', moves: 0, dismissed: false }],
  });
  for (const e of eventsBetween(index, FROM, TO)) {
    assert.ok(typeof e.type === 'string' && e.type in ORDER, 'a known type');
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, 'a date key');
    assert.ok(typeof e.label === 'string');
    assert.ok(typeof e.colour === 'string' && e.colour.startsWith('var(--'));
    assert.ok('amount' in e && 'sub' in e && 'ref' in e);
  }
});

/* ---------------------------------------------------------------- bills */

test('a bill puts each occurrence on the calendar without anything being stored', () => {
  const index = build({
    bills: [{ id: 'b1', name: 'Rent', category: 'Housing', amount: 1200,
              cadence: 'monthly', starts_on: '2026-08-01', ends_on: null }],
    billInstances: [],
  });
  const bills = eventsBetween(index, FROM, TO).filter(e => e.type === 'bill');
  assert.deepEqual(bills.map(e => e.date), ['2026-08-01', '2026-09-01']);
  assert.equal(bills[0].amount, 1200);
  assert.equal(bills[0].paid, false);
});

test('a reminder lands before its bill and carries the bill in its subtitle', () => {
  const index = build({
    bills: [{ id: 'b1', name: 'Car insurance', amount: 210, cadence: 'monthly',
              starts_on: '2026-08-20', ends_on: null, is_auto: true,
              reminder_days_before: 3, reminder_text: 'Move funds to checking' }],
    billInstances: [],
  });
  const list = eventsBetween(index, FROM, TO);
  const remind = list.filter(e => e.type === 'remind');
  assert.deepEqual(remind.map(e => e.date), ['2026-08-17', '2026-09-17']);
  assert.equal(remind[0].label, 'Move funds to checking');
  assert.match(remind[0].sub, /Car insurance/);
  assert.equal(remind[0].done, false);
});

test('a reminder for a bill just past the window still appears', () => {
  /* The reminder is inside the range even though its bill is not, so the
     occurrence scan has to reach past `to` and filter afterwards. */
  const index = buildIndex(dataset({
    bills: [{ id: 'b1', name: 'Rent', amount: 1200, cadence: 'monthly',
              starts_on: '2026-09-03', ends_on: null, reminder_days_before: 5 }],
  }), pd('2026-08-01'), pd('2026-08-31'), TODAY);
  const remind = eventsBetween(index, pd('2026-08-01'), pd('2026-08-31'))
    .filter(e => e.type === 'remind');
  assert.deepEqual(remind.map(e => e.date), ['2026-08-29']);
});

test('a ticked occurrence reads as paid, and an edited one keeps its figure', () => {
  const index = build({
    bills: [{ id: 'b1', name: 'Rent', amount: 1200, cadence: 'monthly',
              starts_on: '2026-08-01', ends_on: null }],
    billInstances: [{ id: 'i1', bill_id: 'b1', due_date: '2026-09-01',
                      amount: 1250, paid_at: '2026-09-01', reminder_done_at: null }],
  });
  const bills = eventsBetween(index, FROM, TO).filter(e => e.type === 'bill');
  const sept = bills.find(e => e.date === '2026-09-01');
  assert.equal(sept.amount, 1250);
  assert.equal(sept.paid, true);
});

test('an ended bill stops appearing, and takes its reminders with it', () => {
  const index = build({
    bills: [{ id: 'b1', name: 'Gym', amount: 40, cadence: 'monthly',
              starts_on: '2026-08-05', ends_on: '2026-08-05',
              reminder_days_before: 2 }],
    billInstances: [],
  });
  const mine = eventsBetween(index, FROM, TO).filter(e => e.ref.bill);
  assert.deepEqual(mine.map(e => `${e.date}:${e.type}`), ['2026-08-03:remind', '2026-08-05:bill']);
});

test('a bill with no start date is skipped rather than throwing', () => {
  const index = build({ bills: [{ id: 'b1', name: 'Broken', amount: 10 }], billInstances: [] });
  assert.deepEqual(eventsBetween(index, FROM, TO).filter(e => e.type === 'bill'), []);
});
