/* Ledger mobile — shared data state.
 *
 * One load, shared by every screen, same shape desktop's calendar.js builds
 * for buildIndex(). Mutating screens call reload() afterward so every other
 * screen's next render sees the change — e.g. ticking a bill in the week view
 * has to be reflected in the Bills screen's progress bar immediately.
 *
 * No DOM here — screens read `state` directly and call reload()/indexFor().
 */

import { today } from '../../../assets/js/dates.js';
import { buildIndex } from '../../../assets/js/events.js';
import {
  loadCards, loadPaybacks, loadNotes, loadBills, loadPaydayOverrides, loadLoan, loadDecisions,
} from '../../../assets/js/data.js';

export const state = {
  cards: [], rewardsByCard: {}, choiceByCard: {}, closesByCard: {},
  paybacks: [], paymentsByPayback: {},
  notes: [],
  bills: [], billInstances: [],
  paydayOverrides: [],
  debt: null, debtPayments: [],
  decisions: [],
};

let listeners = [];
export function onChange(fn) { listeners.push(fn); }
function notify() { listeners.forEach(fn => fn()); }

export async function reload() {
  const [cardsData, pbs, notes, billsData, paydays, loan, decisions] = await Promise.all([
    loadCards(), loadPaybacks(), loadNotes(), loadBills(), loadPaydayOverrides(),
    loadLoan().catch(() => ({ debt: null, payments: [] })), loadDecisions(),
  ]);
  Object.assign(state, {
    cards: cardsData.cards, rewardsByCard: cardsData.rewardsByCard,
    choiceByCard: cardsData.choiceByCard, closesByCard: cardsData.closesByCard,
    paybacks: pbs.paybacks, paymentsByPayback: pbs.paymentsByPayback,
    notes,
    bills: billsData.bills, billInstances: billsData.billInstances,
    paydayOverrides: paydays,
    debt: loan.debt, debtPayments: loan.payments,
    decisions,
  });
  notify();
}

/* Same call desktop's calendar.js makes — one index built per range, so a
 * month grid does not recompute predictions for every one of its 42 cells. */
export function indexFor(from, to) {
  return buildIndex({
    cards: state.cards, closesByCard: state.closesByCard,
    paybacks: state.paybacks, paymentsByPayback: state.paymentsByPayback,
    notes: state.notes, roundupRuns: [], billInstances: state.billInstances, bills: state.bills,
  }, from, to, today());
}
