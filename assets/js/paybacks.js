/* Ledger — payback state
 *
 * Tracks one specific failure: putting something on a card meaning to pay it
 * back in a few days, forgetting, and having it quietly become a bill.
 *
 * The countdown runs to STATEMENT CLOSE, not to the payment due date. Clear it
 * before close and it never appears at all — that is the whole point. The due
 * date is far too late to be useful as a deadline.
 *
 * Every state here is derived from payments and dates rather than stored, so
 * it cannot drift out of sync with the rows it describes. No DOM, no database.
 */

import { calc } from './statements.js';
import { pd, daysBetween } from './dates.js';

const CENT = 0.005;   // money compares to the half-cent, never with ===

/* Everything the UI needs about one payback.
 *
 * `card` is null for an off-card payback — Affirm, a friend, anything. Those
 * have no statement to beat, so no close date and no way to become a bill;
 * the only date that applies is the one the user set. */
export function derive(payback, payments, card, closes, today) {
  const amount = Number(payback.amount);
  const paid = payments.reduce((n, p) => n + Number(p.amount), 0);
  const left = Math.max(0, amount - paid);
  const cleared = left <= CENT;

  const offCard = !card;
  const timing = offCard ? null : calc(card, closes || [], today);
  const closeDate = timing ? timing.close : null;
  const daysToClose = timing ? timing.daysToClose : null;

  const target = pd(payback.intended_payback_on);
  const daysToTarget = daysBetween(today, target);

  /* A cleared payback never becomes a bill, whatever the dates say — that is
     the reward for clearing it, and it drops off the calendar immediately. */
  const becameBill = !cleared && !offCard && daysToClose < 0;

  return {
    payback, payments, card, amount, paid, left, cleared, offCard,
    closeDate, daysToClose, daysToTarget,
    certain: timing ? timing.certain : true,
    becameBill,
    targetPassed: !cleared && daysToTarget < 0,
    state: cleared ? 'cleared' : becameBill ? 'became_bill' : 'open',
    /* Urgency runs to close where there is one, and to the user's own date
       where there isn't. */
    urgency: cleared ? 'ok'
      : offCard ? (daysToTarget < 0 ? 'soon' : 'ok')
      : daysToClose < 3 ? 'late' : daysToClose <= 7 ? 'soon' : 'ok',
    pct: amount ? Math.min(100, Math.round(paid / amount * 100)) : 0,
  };
}

/* Splits everything outstanding four ways. $400 outstanding is a completely
 * different situation depending on how it divides, which is why the header is
 * a split bar rather than a single number. */
export function summarise(derived) {
  const live = derived.filter(d => d.state !== 'became_bill');
  let paid = 0, late = 0, soon = 0, easy = 0;

  live.forEach(d => {
    paid += Math.min(d.paid, d.amount);
    if (d.cleared) return;
    const days = d.offCard ? d.daysToTarget : d.daysToClose;
    if (days < 3) late += d.left;
    else if (days <= 7) soon += d.left;
    else easy += d.left;
  });

  const open = live.filter(d => !d.cleared);
  return {
    fronted: open.reduce((n, d) => n + d.left, 0),
    openCount: open.length,
    closingSoon: open.filter(d => !d.offCard && d.daysToClose < 3).length,
    bar: { paid, late, soon, easy, total: paid + late + soon + easy },
  };
}

/* Clamps a payment to what is actually outstanding. Overpaying a payback is
 * always a slip — the money went somewhere, but not here — so it is recorded
 * at the real figure and the difference is reported rather than swallowed. */
export function clampPayment(requested, left) {
  const amount = Number(requested);
  if (!isFinite(amount) || amount <= 0) return { ok: false, amount: 0, clamped: false };
  if (amount > left + CENT) return { ok: true, amount: left, clamped: true };
  return { ok: true, amount, clamped: false };
}
