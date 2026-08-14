/* Ledger — date helper tests
 *
 *   node --test tests/
 *
 * No dependencies and no build step, matching the app itself. dates.js has no
 * DOM in it precisely so it can be tested this way.
 *
 * The expected week numbers below were cross-checked against GNU `date +%V`,
 * which is an authoritative ISO 8601 implementation, rather than worked out by
 * hand — the year-boundary cases are exactly the ones intuition gets wrong.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isoWeek, key, pd, mon, add, nextDay, dayIndex, isPayday, ordinal, daysBetween,
} from '../assets/js/dates.js';

test('ISO week numbers match GNU date at the year boundary', () => {
  /* The cases that catch a naive implementation: a week can belong to the next
     year before January starts, and a year can have 53 weeks. */
  assert.equal(isoWeek(pd('2025-12-29')), 1,  'Dec 29 2025 is week 1 of 2026');
  assert.equal(isoWeek(pd('2026-01-01')), 1);
  assert.equal(isoWeek(pd('2026-01-04')), 1,  'Sunday still closes week 1');
  assert.equal(isoWeek(pd('2026-01-05')), 2,  'Monday opens week 2');
  assert.equal(isoWeek(pd('2026-12-31')), 53, '2026 is a 53-week year');
  assert.equal(isoWeek(pd('2027-01-03')), 53, 'and week 53 runs into January');
  assert.equal(isoWeek(pd('2020-12-31')), 53);
  assert.equal(isoWeek(pd('2024-02-29')), 9,  'leap day');
});

test('August 2026 runs weeks 31 to 36', () => {
  const weeks = new Set();
  for (let d = 1; d <= 31; d++) {
    weeks.add(isoWeek(new Date(2026, 7, d)));
  }
  assert.deepEqual([...weeks].sort((a, b) => a - b), [31, 32, 33, 34, 35, 36]);
});

test('key and pd round-trip through local midnight', () => {
  /* toISOString() would convert to UTC first and hand back the previous day for
     anyone west of Greenwich. This is the guard against that regression. */
  const k = '2026-08-11';
  const d = pd(k);
  assert.equal(key(d), k);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 11);
});

test('mon returns the Monday of the week, and is idempotent', () => {
  /* Aug 11 2026 is a Tuesday, so its Monday is the 10th. */
  assert.equal(key(mon(pd('2026-08-11'))), '2026-08-10');
  assert.equal(key(mon(pd('2026-08-10'))), '2026-08-10', 'a Monday is its own Monday');
  assert.equal(key(mon(pd('2026-08-16'))), '2026-08-10', 'Sunday belongs to the week that opened it');
  assert.equal(key(mon(mon(pd('2026-08-13')))), '2026-08-10');
});

test('mon crosses a month and a year boundary', () => {
  assert.equal(key(mon(pd('2026-09-02'))), '2026-08-31');
  assert.equal(key(mon(pd('2026-01-01'))), '2025-12-29');
});

test('add crosses months, years and a leap day', () => {
  assert.equal(key(add(pd('2026-08-31'), 1)), '2026-09-01');
  assert.equal(key(add(pd('2026-12-31'), 1)), '2027-01-01');
  assert.equal(key(add(pd('2026-01-01'), -1)), '2025-12-31');
  assert.equal(key(add(pd('2024-02-28'), 1)), '2024-02-29');
  assert.equal(key(add(pd('2026-02-28'), 1)), '2026-03-01', 'no leap day in 2026');
});

test('nextDay finds the next occurrence at or after the reference date', () => {
  assert.equal(key(nextDay(pd('2026-08-11'), 16)), '2026-08-16', 'later this month');
  assert.equal(key(nextDay(pd('2026-08-11'), 7)),  '2026-09-07', 'already passed, so next month');
  assert.equal(key(nextDay(pd('2026-08-11'), 11)), '2026-08-11', 'today counts');
});

test('nextDay clamps to short months rather than rolling forward', () => {
  /* A card closing on the 31st has to close in February too. Rolling into
     March would put a statement close on a date the statement never sees. */
  assert.equal(key(nextDay(pd('2026-02-01'), 31)), '2026-02-28');
  assert.equal(key(nextDay(pd('2024-02-01'), 31)), '2024-02-29', 'leap year gets the 29th');
  assert.equal(key(nextDay(pd('2026-04-15'), 31)), '2026-04-30', 'April has 30 days');
});

test('nextDay crosses the year boundary', () => {
  assert.equal(key(nextDay(pd('2026-12-20'), 5)), '2027-01-05');
});

test('dayIndex is Monday-first and payday is Thursday', () => {
  assert.equal(dayIndex(pd('2026-08-10')), 0, 'Monday');
  assert.equal(dayIndex(pd('2026-08-16')), 6, 'Sunday');
  assert.equal(isPayday(pd('2026-08-13')), true,  'Thursday');
  assert.equal(isPayday(pd('2026-08-11')), false, 'Tuesday');
});

test('daysBetween is whole days and signed', () => {
  assert.equal(daysBetween(pd('2026-08-11'), pd('2026-08-16')), 5);
  assert.equal(daysBetween(pd('2026-08-16'), pd('2026-08-11')), -5);
  assert.equal(daysBetween(pd('2026-08-11'), pd('2026-08-11')), 0);
});

test('ordinal handles the teens', () => {
  assert.equal(ordinal(1),  'st');
  assert.equal(ordinal(2),  'nd');
  assert.equal(ordinal(3),  'rd');
  assert.equal(ordinal(4),  'th');
  assert.equal(ordinal(11), 'th', 'not "st"');
  assert.equal(ordinal(12), 'th');
  assert.equal(ordinal(13), 'th');
  assert.equal(ordinal(21), 'st');
});
