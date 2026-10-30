/* Ledger — Lunch: a daily budget with rollover
 *
 * No DOM, no database — same contract as bills.js/paybacks.js, so both
 * frontends and the Edge Functions can share it.
 *
 * Weekdays only. There is deliberately no "week" object anywhere in this
 * file: a week is just Monday through Friday of a date, derived with
 * dates.js the same way the rest of the app derives its calendar math.
 * `settings.open_week_start` is the one piece of state that isn't
 * derivable — which Monday is still open — because "is this week done"
 * depends on whether its days were actually resolved, not just on what
 * today's date is.
 */

import { pd, key, mon, add, dayIndex } from './dates.js';

export const WEEKDAYS = 5;          // Mon..Fri
export const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export const isWeekday = d => dayIndex(d) < 5;

/* The five weekday Dates of the week starting `weekStart` (a Monday). */
export const weekdaysOf = weekStart => [0, 1, 2, 3, 4].map(i => add(weekStart, i));

export const daySpent = purchases => purchases.reduce((s, p) => s + Number(p.amount), 0);

/* A paused day never counts, either way. A day that hasn't happened yet only
 * counts once something's actually been logged on it — same "derive from
 * what happened" rule the rest of the app follows for bills and paybacks. */
export function countsTowardRollover(day, purchases, today) {
  if (day.paused) return false;
  const isFuture = pd(day.on_date) > today;
  return !isFuture || purchases.length > 0;
}

/* The running balance: a checkpoint plus everything since. `days` only needs
 * to cover on_date > settings.rollover_base_date — callers load a bounded
 * window, not full history. `purchasesByDate` is a plain object keyed by
 * 'YYYY-MM-DD'. */
export function computeRollover(settings, days, purchasesByDate, today) {
  let total = Number(settings.rollover_base);
  days.forEach(day => {
    if (day.on_date <= settings.rollover_base_date) return; // pre-checkpoint, already folded in
    const purchases = purchasesByDate[day.on_date] || [];
    if (countsTowardRollover(day, purchases, today)) {
      total += Number(day.daily_limit) - daySpent(purchases);
    }
  });
  return total;
}

/* Fills in any weekday that hasn't been touched yet (no row created) with a
 * virtual, unsaved day — on the client only, never persisted until something
 * actually happens to it (a purchase, an end, a pause). Mirrors how
 * bill_instances works: a day with no row is one nothing has happened to. */
export function weekDaysWithVirtuals(weekStart, realDays, dailyLimit) {
  const byDate = new Map(realDays.map(d => [d.on_date, d]));
  return weekdaysOf(weekStart).map(d => {
    const k = key(d);
    return byDate.get(k) || { on_date: k, daily_limit: dailyLimit, ended_at: null, paused: false, virtual: true };
  });
}

/* Weekdays at/before `today` that are neither ended nor paused — the
 * backlog that blocks new logging, and what blocks a week from advancing. */
export function unresolvedDays(days, today) {
  return days
    .filter(d => pd(d.on_date) <= today && !d.ended_at && !d.paused)
    .sort((a, b) => a.on_date.localeCompare(b.on_date));
}

/* Specifically days strictly before `today` — today being unresolved
 * doesn't block today, it just means today isn't done yet. */
export function priorUnresolved(days, today) {
  return unresolvedDays(days, today).filter(d => d.on_date < key(today));
}

/* A day is only ever pausable if nothing's been logged on it — pausing
 * discards a day from the rollover math entirely, so a day with real
 * purchases on it must be ended, never paused, or that spending silently
 * stops counting. */
export const isPausable = (day, purchasesByDate) => !(purchasesByDate[day.on_date] || []).length;

/* True once every weekday of `weekStart` is resolved — the one condition
 * that lets the open week actually advance. */
export function weekFullyResolved(weekStart, days) {
  const required = weekdaysOf(weekStart).map(key);
  const byDate = new Map(days.map(d => [d.on_date, d]));
  return required.every(k => {
    const d = byDate.get(k);
    return d && (d.ended_at || d.paused);
  });
}

/* Groups a flat list of lunch_days into weeks for the closed-weeks history
 * list, newest first. Only ever called on days strictly before the open
 * week — closed history, nothing live. */
export function groupIntoWeeks(days, purchasesByDate) {
  const byWeek = new Map();
  days.forEach(day => {
    const wk = key(mon(pd(day.on_date)));
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(day);
  });
  return [...byWeek.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([weekStart, weekDays]) => {
      weekDays.sort((a, b) => a.on_date.localeCompare(b.on_date));
      return {
        weekStart,
        days: weekDays,
        spent: weekDays.reduce((s, d) => s + daySpent(purchasesByDate[d.on_date] || []), 0),
        budget: weekDays.reduce((s, d) => s + Number(d.daily_limit), 0),
        hadPause: weekDays.some(d => d.paused),
      };
    });
}

/* How many real weeks sit between the end of the most recent closed week and
 * the start of the next one — a gap that was never created as data because
 * the open week was stuck the whole time. 0 when there's no gap. */
export function gapWeeksBetween(priorWeekStart, nextWeekStart) {
  if (!priorWeekStart) return 0;
  const days = Math.round((pd(nextWeekStart) - pd(priorWeekStart)) / 864e5);
  const weeks = Math.round(days / 7) - 1;
  return Math.max(0, weeks);
}
