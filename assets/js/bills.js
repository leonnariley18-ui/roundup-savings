/* Ledger — bill recurrence
 *
 * Occurrences are derived from a bill's definition, never stored ahead.
 * Generating them would mean a scheduled job, thousands of rows nobody reads,
 * and a horizon that quietly runs out one day. Deriving them means a bill
 * entered today is on the calendar for 2031 immediately, and editing its
 * cadence corrects every future date at once.
 *
 * bill_instances holds only what has actually been touched — a tick, an edited
 * amount, a reminder dealt with. An occurrence with no row is one nothing has
 * happened to yet.
 *
 * No DOM, no database.
 */

import { key, pd, add, daysBetween } from './dates.js';

export const CADENCES = [
  ['monthly',   'Every month'],
  ['biweekly',  'Every 2 weeks'],
  ['weekly',    'Every week'],
  ['quarterly', 'Every 3 months'],
  ['yearly',    'Every year'],
  ['once',      "Just once — doesn't repeat"],
];

export const cadenceLabel = c => (CADENCES.find(x => x[0] === c) || ['', c])[1];

/* Adds months while clamping to short ones: a bill anchored on the 31st falls
 * on the 28th in February rather than rolling into March, which would put it
 * in the wrong month entirely. */
function addMonths(anchor, n) {
  const d = new Date(anchor.getFullYear(), anchor.getMonth() + n, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(anchor.getDate(), last));
  return d;
}

const STEP = {
  monthly:   (anchor, i) => addMonths(anchor, i),
  quarterly: (anchor, i) => addMonths(anchor, i * 3),
  yearly:    (anchor, i) => addMonths(anchor, i * 12),
  weekly:    (anchor, i) => add(anchor, i * 7),
  biweekly:  (anchor, i) => add(anchor, i * 14),
  once:      (anchor, i) => (i === 0 ? new Date(anchor) : null),
};

/* Every date this bill falls due between `from` and `to`.
 *
 * starts_on is the anchor for all of them — its day-of-month for the monthly
 * family, its weekday for the weekly one. A bill that starts in the future
 * simply has no occurrences before it, which is what makes future-dating work
 * without a special case. */
export function occurrences(bill, from, to) {
  /* A definition with no start has no occurrences. Returning nothing rather
     than throwing keeps one malformed row from taking the calendar down. */
  if (!bill || !bill.starts_on) return [];

  const step = STEP[bill.cadence] || STEP.monthly;
  const anchor = pd(bill.starts_on);
  const ends = bill.ends_on ? pd(bill.ends_on) : null;
  const out = [];

  /* Start counting from the first occurrence at or after `from`, rather than
     walking from starts_on, so a bill running since 2019 costs the same as one
     starting tomorrow. */
  let i = 0;
  if (anchor < from) {
    if (bill.cadence === 'weekly') i = Math.floor(daysBetween(anchor, from) / 7);
    else if (bill.cadence === 'biweekly') i = Math.floor(daysBetween(anchor, from) / 14);
    else if (bill.cadence === 'monthly') i = monthsBetween(anchor, from);
    else if (bill.cadence === 'quarterly') i = Math.floor(monthsBetween(anchor, from) / 3);
    else if (bill.cadence === 'yearly') i = Math.floor(monthsBetween(anchor, from) / 12);
    i = Math.max(0, i - 1);   // step back one, so nothing at the boundary is missed
  }

  for (let guard = 0; guard < 400; guard++, i++) {
    const d = step(anchor, i);
    if (!d) break;                    // 'once' past its single date
    if (d > to) break;
    if (ends && d > ends) break;
    if (d >= from && d >= anchor) out.push(d);
  }
  return out;
}

const monthsBetween = (a, b) =>
  (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());

/* The reminder that belongs to one occurrence.
 *
 * Reminders are derived from occurrences rather than stored separately, which
 * is what makes them disappear when a bill ends — there is no occurrence, so
 * there is no reminder, and nothing has to be cleaned up. */
export function reminderFor(bill, dueDate) {
  if (!bill.reminder_days_before) return null;
  return {
    date: add(dueDate, -bill.reminder_days_before),
    dueDate,
    text: bill.reminder_text || 'Make sure the funds are in the right account',
  };
}

/* Merges a bill's derived occurrences with whatever rows exist for them. */
export function occurrencesWithState(bill, instances, from, to) {
  const byDate = new Map(instances.filter(i => i.bill_id === bill.id).map(i => [i.due_date, i]));
  return occurrences(bill, from, to).map(date => {
    const k = key(date);
    const row = byDate.get(k) || null;
    return {
      bill, date, dateKey: k,
      instance: row,
      amount: row && row.amount != null ? Number(row.amount) : Number(bill.amount),
      paid: !!(row && row.paid_at),
      reminderDone: !!(row && row.reminder_done_at),
      reminder: reminderFor(bill, date),
    };
  });
}

/* ---------------------------------------------------------------- payday */

/* Payday is Thursday unless a week says otherwise.
 *
 * An override names the replacement date, and the week it belongs to is worked
 * out from that date — so moving Thursday to Friday is one row saying "Friday",
 * not a pair saying "not Thursday" and "yes Friday" that could disagree. */
export function paydayFor(weekMonday, overrides = []) {
  const weekKey = key(weekMonday);
  const hit = overrides.find(o => key(mondayOf(pd(o.on_date))) === weekKey);
  return hit ? pd(hit.on_date) : add(weekMonday, 3);   // Thursday
}

function mondayOf(d) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
}

export function isPaydayOn(date, overrides = []) {
  return key(paydayFor(mondayOf(date), overrides)) === key(date);
}
