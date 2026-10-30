/* Ledger — Lunch: rollover, backlog, and week-grouping logic */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pd, key } from '../assets/js/dates.js';
import {
  computeRollover, countsTowardRollover, unresolvedDays, priorUnresolved,
  isPausable, weekFullyResolved, weekDaysWithVirtuals, groupIntoWeeks,
  gapWeeksBetween, weekdaysOf,
} from '../assets/js/lunch.js';

const settings = (over = {}) => ({
  daily_limit: 40, rollover_base: 0, rollover_base_date: '2026-10-01', ...over,
});

const day = (on_date, over = {}) => ({ on_date, daily_limit: 40, ended_at: null, paused: false, ...over });

/* ---------------------------------------------------------------- rollover */

test('an unspent day banks the difference, a day over spends past it', () => {
  const today = pd('2026-10-30');
  const days = [day('2026-10-26', { ended_at: 'x' }), day('2026-10-27', { ended_at: 'x' })];
  const purchases = { '2026-10-26': [{ amount: 25 }], '2026-10-27': [{ amount: 55 }] };
  // +15 banked, -15 deficit → net 0
  assert.equal(computeRollover(settings(), days, purchases, today), 0);
});

test('a paused day contributes nothing either way, even if it has stray purchases', () => {
  const today = pd('2026-10-30');
  const days = [day('2026-10-26', { paused: true })];
  const purchases = { '2026-10-26': [{ amount: 999 }] };
  assert.equal(computeRollover(settings(), days, purchases, today), 0);
});

test('days before the rollover checkpoint are ignored — already folded into the base', () => {
  const today = pd('2026-10-30');
  const days = [day('2026-09-01', { ended_at: 'x' })]; // before rollover_base_date
  const purchases = {};
  assert.equal(computeRollover(settings({ rollover_base: 50 }), days, purchases, today), 50);
});

test('a future day with nothing logged does not count; one with something logged does', () => {
  const today = pd('2026-10-29');
  const untouched = day('2026-10-30'); // tomorrow, nothing logged
  const preLogged = day('2026-10-31', {}); // day after, but pre-logged
  assert.equal(countsTowardRollover(untouched, [], today), false);
  assert.equal(countsTowardRollover(preLogged, [{ amount: 5 }], today), true);
});

/* ---------------------------------------------------------------- backlog */

test('unresolved days are only ones at or before today, never ended or paused', () => {
  const today = pd('2026-10-29'); // Thursday
  const days = [
    day('2026-10-26', { ended_at: 'x' }),   // Mon — resolved
    day('2026-10-27'),                      // Tue — unresolved
    day('2026-10-28', { paused: true }),    // Wed — resolved via pause
    day('2026-10-29'),                      // Thu — today, unresolved
    day('2026-10-30'),                      // Fri — future, excluded
  ];
  const out = unresolvedDays(days, today).map(d => d.on_date);
  assert.deepEqual(out, ['2026-10-27', '2026-10-29']);
});

test('priorUnresolved excludes today itself — today being open does not block today', () => {
  const today = pd('2026-10-29');
  const days = [day('2026-10-27'), day('2026-10-29')];
  const out = priorUnresolved(days, today).map(d => d.on_date);
  assert.deepEqual(out, ['2026-10-27']);
});

test('a day is only pausable if nothing has been logged on it', () => {
  const empty = day('2026-10-27');
  const logged = day('2026-10-28');
  const purchasesByDate = { '2026-10-28': [{ amount: 12 }] };
  assert.equal(isPausable(empty, purchasesByDate), true);
  assert.equal(isPausable(logged, purchasesByDate), false);
});

/* ---------------------------------------------------------------- the week */

test('a week is not fully resolved until every weekday in it is ended or paused', () => {
  const weekStart = pd('2026-10-26'); // Monday
  const partial = weekdaysOf(weekStart).slice(0, 4).map(d => day(key(d), { ended_at: 'x' }));
  assert.equal(weekFullyResolved(weekStart, partial), false, 'Friday never got a row at all');

  const full = weekdaysOf(weekStart).map(d => day(key(d), { ended_at: 'x' }));
  assert.equal(weekFullyResolved(weekStart, full), true);

  const fullViaPause = weekdaysOf(weekStart).map((d, i) => day(key(d), i === 4 ? { paused: true } : { ended_at: 'x' }));
  assert.equal(weekFullyResolved(weekStart, fullViaPause), true, 'a pause resolves a day just as well as ending it');
});

test('a day nothing has touched yet shows up as a virtual, unsaved day', () => {
  const weekStart = pd('2026-10-26');
  const real = [day('2026-10-26', { ended_at: 'x' })];
  const out = weekDaysWithVirtuals(weekStart, real, 40);
  assert.equal(out.length, 5);
  assert.equal(out[0].virtual, undefined, 'the real Monday row is used as-is');
  assert.equal(out[1].virtual, true, 'Tuesday has no row yet');
  assert.equal(out[1].daily_limit, 40, 'a virtual day still carries the current limit');
});

test('grouping into weeks sorts newest first and totals each one', () => {
  const days = [
    day('2026-10-19', { daily_limit: 40 }), day('2026-10-20', { daily_limit: 40 }),
    day('2026-10-26', { daily_limit: 40 }), day('2026-10-27', { daily_limit: 40, paused: true }),
  ];
  const purchases = { '2026-10-19': [{ amount: 25 }], '2026-10-26': [{ amount: 50 }] };
  const weeks = groupIntoWeeks(days, purchases);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].weekStart, '2026-10-26', 'newest week first');
  assert.equal(weeks[0].spent, 50);
  assert.equal(weeks[0].hadPause, true);
  assert.equal(weeks[1].weekStart, '2026-10-19');
  assert.equal(weeks[1].spent, 25);
});

test('a real gap between two weeks is counted; back-to-back weeks are not a gap', () => {
  assert.equal(gapWeeksBetween('2026-10-19', '2026-10-26'), 0, 'the very next Monday is no gap at all');
  assert.equal(gapWeeksBetween('2026-10-19', '2026-11-16'), 3, 'three full weeks skipped in between');
  assert.equal(gapWeeksBetween(null, '2026-10-26'), 0, 'nothing to compare against yet');
});
