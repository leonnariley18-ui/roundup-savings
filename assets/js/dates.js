/* Ledger — date helpers
 *
 * No DOM in this file, deliberately. A second frontend is planned and the
 * Edge Functions need the same week and cycle arithmetic, so everything here
 * has to run anywhere. That is also what makes it testable — see tests/.
 *
 * The prototype froze TODAY to 2026-08-11 so the screens stayed still while
 * they were being designed. Here it is the real date. Everything date-derived
 * moves when this does, which is why the tests pin explicit dates rather than
 * calling today().
 */

export const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const MFULL = ['January','February','March','April','May','June','July',
                      'August','September','October','November','December'];
export const DW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

/* Local midnight today. Local, not UTC: "what day is it" is a question about
 * where the user is standing, and a UTC answer is wrong for a third of the day. */
export function today() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/* The Monday of d's week. Everything in this app is Monday-start — the grid,
 * the week view, the ISO week numbers and the date pickers all agree. */
export const mon = d => {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
};

export const add = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/* Date -> '2026-08-11'. Built by hand from local parts rather than via
 * toISOString(), which converts to UTC first and hands back the wrong day
 * for anyone west of Greenwich for most of the evening. */
export const key = d =>
  d.getFullYear() + '-' +
  String(d.getMonth() + 1).padStart(2, '0') + '-' +
  String(d.getDate()).padStart(2, '0');

/* '2026-08-11' -> Date at local midnight. new Date(str) would read it as UTC
 * for the same reason, so the parts are split out explicitly. */
export const pd = s => {
  const [a, b, c] = s.split('-').map(Number);
  return new Date(a, b - 1, c);
};

export const dayIndex = d => (d.getDay() + 6) % 7;      // 0 = Monday
export const isPayday = d => d.getDay() === 4;          // Thursday
export const fmtD = d => MN[d.getMonth()] + ' ' + d.getDate();
export const fmtDW = d => DW[dayIndex(d)] + ' ' + d.getDate() + ' ' + MN[d.getMonth()];
export const daysBetween = (a, b) => Math.round((b - a) / 864e5);

export const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
};

export const money = n =>
  '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ISO 8601 week number — Monday start, same convention Outlook and Google use.
 * Works by jumping to the Thursday of d's week, because ISO defines a week's
 * year by which year that Thursday falls in. That is what makes the turn of
 * the year come out right: Dec 29 2025 is week 1 of 2026, not week 53. */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const f = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
}

/* The next occurrence of a calendar day at or after `from`, clamped to months
 * that are too short. Asking for the 31st in February gives the 28th or 29th
 * rather than silently rolling into March. */
export function nextDay(from, day) {
  let y = from.getFullYear(), m = from.getMonth();
  const clamp = (yy, mm) => Math.min(day, new Date(yy, mm + 1, 0).getDate());
  let c = new Date(y, m, clamp(y, m));
  if (c < from) {
    m++;
    if (m > 11) { m = 0; y++; }
    c = new Date(y, m, clamp(y, m));
  }
  return c;
}
