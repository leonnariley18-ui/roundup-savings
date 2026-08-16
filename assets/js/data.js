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
