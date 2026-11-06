import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weeklyMondays, targetForWeek, openWeeks, targetTotal,
  clampTreat, savedAmount, delta, nextOpenMonday, neverStarted,
} from '../assets/js/save.js';

test('weeklyMondays lists every Monday in range, inclusive', () => {
  assert.deepEqual(weeklyMondays('2026-10-20', '2026-11-03'),
    ['2026-10-20', '2026-10-27', '2026-11-03']);
});

test('weeklyMondays is empty once the open start is after the cutoff', () => {
  assert.deepEqual(weeklyMondays('2026-11-10', '2026-11-03'), []);
});

test('a single Monday range returns just that one week', () => {
  assert.deepEqual(weeklyMondays('2026-11-03', '2026-11-03'), ['2026-11-03']);
});

test('targetForWeek picks the most recent history entry at or before the week', () => {
  const history = [
    { effective_monday: '2026-09-01', target: 40 },
    { effective_monday: '2026-10-06', target: 50 },
  ];
  assert.equal(targetForWeek(history, '2026-09-15'), 40);
  assert.equal(targetForWeek(history, '2026-10-06'), 50);
  assert.equal(targetForWeek(history, '2026-10-20'), 50);
});

test('targetForWeek returns null when a week predates any history', () => {
  const history = [{ effective_monday: '2026-10-06', target: 50 }];
  assert.equal(targetForWeek(history, '2026-09-01'), null);
});

test('openWeeks pairs each open Monday with its own target, not a flat current one', () => {
  const history = [
    { effective_monday: '2026-09-01', target: 40 },
    { effective_monday: '2026-11-03', target: 50 },
  ];
  const weeks = openWeeks('2026-10-20', '2026-11-03', history);
  assert.deepEqual(weeks, [
    { monday: '2026-10-20', target: 40 },
    { monday: '2026-10-27', target: 40 },
    { monday: '2026-11-03', target: 50 },
  ]);
  assert.equal(targetTotal(weeks), 130);
});

test('a treat can never exceed the total it is carved out of', () => {
  assert.equal(clampTreat(100, 20), 20);
  assert.equal(clampTreat(100, 150), 100);
  assert.equal(clampTreat(100, -5), 0);
});

test('saved is whatever is left after the (clamped) treat comes out', () => {
  assert.equal(savedAmount(100, 20), 80);
  assert.equal(savedAmount(100, 150), 0);
  assert.equal(savedAmount(100, 0), 100);
});

test('delta is ahead when positive, behind when negative, around a target', () => {
  assert.equal(delta(130, 120), 10);
  assert.equal(delta(90, 120), -30);
});

test('the next open week starts exactly one week after the last swept week', () => {
  assert.equal(nextOpenMonday('2026-11-03'), '2026-11-10');
});

test('never started means no settings row, or one with no target set yet', () => {
  assert.equal(neverStarted(null), true);
  assert.equal(neverStarted({ weekly_target: null }), true);
  assert.equal(neverStarted({ weekly_target: 40 }), false);
});
