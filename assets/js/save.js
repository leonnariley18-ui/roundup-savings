/* Ledger — Save: sweeping Lunch's banked rollover into savings, weekly
 *
 * No DOM, no database — same contract as lunch.js/bills.js/paybacks.js, so
 * both frontends share it unchanged.
 *
 * There is no "week" row anywhere here, on purpose. A week is just a
 * Monday, and every open week's own target is looked up from a small
 * history of target changes rather than snapshotted onto anything, because
 * nothing ever happens to a week before it gets swept — unlike Lunch's
 * days, which get a row the moment a purchase or an End touches them.
 */

import { pd, key, add } from './dates.js';

/* Every Monday from `openWeekStart` through `uptoMonday`, inclusive. Empty
 * once openWeekStart is in the future relative to uptoMonday — that's the
 * "nothing open yet" state, not an error. */
export function weeklyMondays(openWeekStart, uptoMonday) {
  const out = [];
  let cursor = pd(openWeekStart);
  const end = pd(uptoMonday);
  while (cursor <= end) {
    out.push(key(cursor));
    cursor = add(cursor, 7);
  }
  return out;
}

/* The target in effect for a given Monday: the most recent history entry
 * at or before it. `history` is a plain array of {effective_monday, target},
 * any order — sorted here rather than trusted from the caller. */
export function targetForWeek(history, monday) {
  const applicable = history
    .filter(h => h.effective_monday <= monday)
    .sort((a, b) => b.effective_monday.localeCompare(a.effective_monday));
  return applicable.length ? Number(applicable[0].target) : null;
}

/* Every currently open week, each paired with its own target. */
export function openWeeks(openWeekStart, uptoMonday, history) {
  return weeklyMondays(openWeekStart, uptoMonday).map(monday => ({
    monday,
    target: targetForWeek(history, monday),
  }));
}

export const targetTotal = weeks => weeks.reduce((s, w) => s + (Number(w.target) || 0), 0);

/* A treat can never exceed the total being swept — it's carved out of it,
 * not added on top. */
export const clampTreat = (total, treat) => Math.min(Math.max(0, treat), Math.max(0, total));

export const savedAmount = (total, treat) => Math.max(0, total - clampTreat(total, treat));

export const delta = (saved, target) => saved - target;

/* The Monday the next open week will start on, once the current open range
 * is fully swept away. */
export const nextOpenMonday = lastWeeksTo => key(add(pd(lastWeeksTo), 7));

export const neverStarted = settings => !settings || settings.weekly_target == null;
