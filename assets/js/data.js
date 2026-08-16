/* Ledger — data access
 *
 * Everything that touches Supabase. No DOM here, so a second frontend can sit
 * on this file unchanged.
 *
 * The client is configured with `db: { schema: 'ledger' }`, so a bare table
 * name here means ledger.<table> and never public.<table>. That is what keeps
 * this app from ever reading or writing the other application in this project.
 */

import { run, getDb } from './db.js';

/* ---------------------------------------------------------------- reading */

/* One round trip per table rather than nested selects. The whole dataset is a
 * few hundred rows at most, and flat queries keep the shapes obvious. */
export async function loadCards() {
  const db = getDb();

  const [cards, rewards, choices, closes] = await Promise.all([
    run(db.from('cards').select('*').eq('active', true).order('credit_limit', { ascending: false })),
    run(db.from('card_rewards').select('*')),
    run(db.from('card_choice_categories').select('*').order('effective_from', { ascending: false })),
    run(db.from('statement_closes').select('*').order('closed_on', { ascending: false })),
  ]);

  const rewardsByCard = {};
  rewards.forEach(r => (rewardsByCard[r.card_id] ||= []).push(r));

  /* The current choice is the row with the latest effective_from. Earlier rows
     are history and are deliberately kept. */
  const choiceByCard = {};
  choices.forEach(c => { if (!(c.card_id in choiceByCard)) choiceByCard[c.card_id] = c.category; });

  const closesByCard = {};
  closes.forEach(c => (closesByCard[c.card_id] ||= []).push(c.closed_on));

  return { cards, rewardsByCard, choiceByCard, closesByCard, closeRows: closes };
}

export const loadDecisions = () =>
  run(getDb().from('card_decisions').select('*').order('decided_at', { ascending: false }).limit(50));

/* ---------------------------------------------------------------- writing */

/* Append-only. The dashboard never reads this table; it exists for the future
 * game layer, and the payload carries enough to reconstruct what happened. */
export async function logEvent(kind, payload = {}) {
  try {
    await run(getDb().from('events').insert({ kind, payload }));
  } catch (err) {
    /* An event that fails to write must never break the action that caused it.
       Nothing reads this table yet, and a lost row is worth less than a lost
       statement observation. */
    console.warn('event not recorded:', kind, err.message);
  }
}

/* An observation, never a prediction. The pattern is derived from these rows
 * on every read, so writing a predicted date here would feed a guess back in
 * as evidence and quietly harden it into a fact. */
export async function logClose(cardId, closedOn) {
  const rows = await run(getDb().from('statement_closes')
    .insert({ card_id: cardId, closed_on: closedOn, source: 'manual' })
    .select());
  await logEvent('statement_close_logged', { card_id: cardId, closed_on: closedOn });
  return rows[0];
}

export async function removeClose(id) {
  await run(getDb().from('statement_closes').delete().eq('id', id));
}

export async function setApr(cardId, apr) {
  await run(getDb().from('cards').update({ apr }).eq('id', cardId));
}

export async function setCapBlown(cardId, blown) {
  await run(getDb().from('cards').update({ cap_blown: blown }).eq('id', cardId));
}

/* Appends rather than updates, so switching the 3% slot keeps its history. */
export async function setChoiceCategory(cardId, category) {
  await run(getDb().from('card_choice_categories')
    .insert({ card_id: cardId, category, effective_from: new Date().toISOString().slice(0, 10) }));
}

/* "I used this card" — written only from the recommendation, and stamped with
 * the scrubbed date rather than now, because that is the day being decided. */
export async function logDecision({ cardId, category, amount, rewardPct, rewardAmount, decidedAt }) {
  const rows = await run(getDb().from('card_decisions').insert({
    card_id: cardId,
    category,
    amount: amount || null,
    reward_pct: rewardPct,
    reward_amount: rewardAmount ?? null,
    decided_at: decidedAt,
  }).select());
  await logEvent('card_decision_logged', { card_id: cardId, category, amount: amount || null });
  return rows[0];
}

export async function removeDecision(id) {
  await run(getDb().from('card_decisions').delete().eq('id', id));
}

/* ---------------------------------------------------------------- paybacks */

export async function loadPaybacks() {
  const db = getDb();
  const [paybacks, payments] = await Promise.all([
    run(db.from('paybacks').select('*').order('created_at', { ascending: false })),
    run(db.from('payback_payments').select('*').order('paid_at', { ascending: true })),
  ]);

  const paymentsByPayback = {};
  payments.forEach(p => (paymentsByPayback[p.payback_id] ||= []).push(p));

  return { paybacks, paymentsByPayback };
}

export async function createPayback({ description, amount, cardId, incurredOn, intendedOn }) {
  const rows = await run(getDb().from('paybacks').insert({
    description, amount,
    card_id: cardId || null,          // null = off-card, and it stays that way
    incurred_on: incurredOn,
    intended_payback_on: intendedOn,
  }).select());
  return rows[0];
}

export async function addPayment(paybackId, amount, paidAt) {
  const rows = await run(getDb().from('payback_payments')
    .insert({ payback_id: paybackId, amount, paid_at: paidAt }).select());
  return rows[0];
}

/* Undo removes the last payment rather than zeroing the total, so a mistyped
 * figure costs one click and the rest of the history survives. */
export async function removeLastPayment(paybackId, payments) {
  if (!payments.length) return;
  const last = payments[payments.length - 1];
  await run(getDb().from('payback_payments').delete().eq('id', last.id));
  return last;
}

export async function setPaybackStatus(id, status) {
  await run(getDb().from('paybacks').update({ status }).eq('id', id));
}

/* The count is stored and never displayed. Surfacing it would turn a helpful
 * affordance into a scold, and the point of offering a new date is that moving
 * one is not a failure. */
export async function reschedulePayback(id, newDate, currentMoves) {
  await run(getDb().from('paybacks')
    .update({ intended_payback_on: newDate, moves: (currentMoves || 0) + 1 }).eq('id', id));
  await logEvent('payback_rescheduled', { payback_id: id, to: newDate });
}

/* Sets a flag, never deletes. The purchase is still on that statement whether
 * or not you want to look at it. */
export async function dismissPayback(id, dismissed) {
  await run(getDb().from('paybacks').update({ dismissed }).eq('id', id));
}
