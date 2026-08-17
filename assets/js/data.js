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

/* A typed balance records when it was typed. Without that the figure is
 * indistinguishable from a synced one, and the whole point is that the reader
 * can tell how much to trust it. */
export async function setCardBalance(cardId, balance) {
  await run(getDb().from('cards').update({
    current_balance: balance,
    balance_synced_at: new Date().toISOString(),
    balance_source: 'manual',
  }).eq('id', cardId));
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

export async function createPayback({ description, amount, cardId, incurredOn, intendedOn, offCardLabel }) {
  const rows = await run(getDb().from('paybacks').insert({
    description, amount,
    card_id: cardId || null,          // null = off-card, and it stays that way
    off_card_label: cardId ? null : (offCardLabel || null),
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

/* ---------------------------------------------------------------- notes */

/* Notes live in the day modal and nowhere else — per-day, not a general
 * notebook. There is nowhere on the calendar you cannot open and jot on. */
export const loadNotes = () =>
  run(getDb().from('notes').select('*').order('created_at', { ascending: true }));

export async function addNote(onDate, body) {
  const rows = await run(getDb().from('notes').insert({ on_date: onDate, body }).select());
  return rows[0];
}

export async function updateNote(id, body) {
  await run(getDb().from('notes').update({ body }).eq('id', id));
}

export async function removeNote(id) {
  await run(getDb().from('notes').delete().eq('id', id));
}

/* ---------------------------------------------------------------- round-ups */

/* A date and nothing else, deliberately. The amount lives in the bank, not
 * here — a tracker that only ever sees money going in drifts into fiction the
 * first time you withdraw some. */
export const loadRoundupRuns = () =>
  run(getDb().from('roundup_runs').select('*').order('ran_on', { ascending: false }));

/* Still no amount — that lives in the bank. But which range was swept is a
 * fact about what you did, and without it a marker months later says nothing. */
export async function addRoundupRun(ranOn, rangeStart = null, rangeEnd = null) {
  const rows = await run(getDb().from('roundup_runs')
    .insert({ ran_on: ranOn, range_start: rangeStart, range_end: rangeEnd }).select());
  await logEvent('roundup_run', { ran_on: ranOn, range_start: rangeStart, range_end: rangeEnd });
  return rows[0];
}

export async function removeRoundupRun(id) {
  await run(getDb().from('roundup_runs').delete().eq('id', id));
}

/* ---------------------------------------------------------------- bills */

/* Empty until the Lunch Money sync exists. Returned in the shape the calendar
 * expects so the grid works identically once they arrive. */
export async function loadBills() {
  const db = getDb();
  const [bills, instances] = await Promise.all([
    run(db.from('bills').select('*').eq('active', true)),
    run(db.from('bill_instances').select('*')),
  ]);
  return { bills, billInstances: instances };
}

/* ---------------------------------------------------------------- the loan */

export async function loadLoan() {
  const db = getDb();
  const [debts, payments] = await Promise.all([
    run(db.from('debts').select('*').eq('status', 'active')),
    run(db.from('debt_payments').select('*').order('paid_at', { ascending: true })),
  ]);
  const debt = debts[0] || null;
  return { debt, payments: debt ? payments.filter(p => p.debt_id === debt.id) : [] };
}

/* Both portions are stored on the row rather than recomputed later, so history
 * stays accurate if the rate ever changes. `source` distinguishes manual from
 * a future Lunch Money matcher, which can become a second writer with no
 * schema change. */
export async function logDebtPayment({ debtId, amount, paidAt, principal, interest }) {
  const rows = await run(getDb().from('debt_payments').insert({
    debt_id: debtId, amount, paid_at: paidAt,
    principal_portion: principal, interest_portion: interest,
    source: 'manual',
  }).select());
  await logEvent('loan_payment_posted', { debt_id: debtId, amount, paid_at: paidAt });
  return rows[0];
}

export async function removeDebtPayment(id) {
  await run(getDb().from('debt_payments').delete().eq('id', id));
}

export async function setDebtBalance(debtId, balance) {
  await run(getDb().from('debts').update({ current_balance: balance }).eq('id', debtId));
}

/* ---------------------------------------------------------------- functions */

/* Every Lunch Money call goes through an Edge Function. The token lives in
 * Supabase secrets and must never reach the browser, so there is deliberately
 * no direct path from this file to Lunch Money. */
export async function callFunction(name, body = {}) {
  const db = getDb();
  if (!db) throw new Error('Not connected to Supabase');
  const { data, error } = await db.functions.invoke(name, { body });
  if (error) {
    /* Supabase wraps the function's own message; surfacing it is what makes a
       missing secret or an unmatched card diagnosable from the UI. */
    const detail = data && data.error ? data.error : error.message;
    throw new Error(detail);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

/* ---------------------------------------------------------------- bill instances */

/* Marking a bill paid is local and manual. Nothing reads Lunch Money's
 * reviewed flag and nothing writes back — the tick records "I looked at it",
 * not "the charge posted", and those come apart exactly when it matters. */
export async function setBillPaid(instanceId, paidAt) {
  await run(getDb().from('bill_instances').update({ paid_at: paidAt }).eq('id', instanceId));
  if (paidAt) await logEvent('bill_paid', { bill_instance_id: instanceId, paid_at: paidAt });
}

export async function setBillAmount(instanceId, amount) {
  await run(getDb().from('bill_instances').update({ amount }).eq('id', instanceId));
}

/* Stated once, then stored. 'none' is a real answer — it means the card is
 * deliberately not in Lunch Money and its balance is the user's to keep. */
export async function setCardLink(cardId, accountId) {
  await run(getDb().from('cards')
    .update({ lunchmoney_account_id: accountId }).eq('id', cardId));
}

/* ---------------------------------------------------------------- bills (manual) */

/* Definitions only. Occurrences are derived from these on read — see bills.js. */
export async function saveBill(bill) {
  const row = {
    name: bill.name, category: bill.category || null,
    amount: bill.amount, cadence: bill.cadence,
    starts_on: bill.starts_on, ends_on: bill.ends_on || null,
    is_auto: !!bill.is_auto,
    reminder_days_before: bill.reminder_days_before || null,
    reminder_text: bill.reminder_text || null,
    notes: bill.notes || null,
    active: true,
  };
  if (bill.id) {
    await run(getDb().from('bills').update(row).eq('id', bill.id));
    return { ...row, id: bill.id };
  }
  const rows = await run(getDb().from('bills').insert(row).select());
  return rows[0];
}

/* Deactivated rather than deleted, so instances already ticked keep meaning. */
export async function archiveBill(id) {
  await run(getDb().from('bills').update({ active: false }).eq('id', id));
}

/* At most one bill is ever "the loan" — pass the debt's id to link a bill to
 * it (clearing whichever bill held it before), or null to unlink. */
export async function setBillLoanLink(billId, debtId) {
  const db = getDb();
  if (debtId) {
    await run(db.from('bills').update({ links_to_debt_id: null })
      .eq('links_to_debt_id', debtId).neq('id', billId));
  }
  await run(db.from('bills').update({ links_to_debt_id: debtId }).eq('id', billId));
}

/* An occurrence has no row until something happens to it, so every write here
 * is an upsert on (bill_id, due_date) rather than an update. */
export async function touchOccurrence(billId, dueDate, patch) {
  const rows = await run(getDb().from('bill_instances')
    .upsert({ bill_id: billId, due_date: dueDate, ...patch }, { onConflict: 'bill_id,due_date' })
    .select());
  if (patch.paid_at) await logEvent('bill_paid', { bill_id: billId, due_date: dueDate });
  return rows[0];
}

/* ---------------------------------------------------------------- payday */

export const loadPaydayOverrides = () =>
  run(getDb().from('payday_overrides').select('*'));

export async function movePayday(onDate) {
  const rows = await run(getDb().from('payday_overrides')
    .upsert({ on_date: onDate }, { onConflict: 'user_id,on_date' }).select());
  return rows[0];
}

export async function clearPaydayOverride(id) {
  await run(getDb().from('payday_overrides').delete().eq('id', id));
}
