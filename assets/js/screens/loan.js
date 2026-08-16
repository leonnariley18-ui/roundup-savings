/* Ledger — the loan
 *
 * A modal, not a page. Opens from the drawer and from the loan row in the week
 * view, and it is one component both mount.
 *
 * Plain numbers. No gamification in the dashboard — that belongs to the game
 * layer and is deliberately excluded here.
 *
 * Until the first payment posts the whole thing is a projection and says so.
 * Every figure is computed from the terms and the logged payments; none of it
 * is written down anywhere.
 */

import { today, key, pd, fmtD, money, MFULL } from '../dates.js';
import { schedule, payoffDate, comparison, costOfOneMinimumMonth,
         position, splitPayment } from '../loan.js';
import { loadLoan, logDebtPayment, removeDebtPayment, setDebtBalance } from '../data.js';
import { dateField, dateValue } from '../ui/datepicker.js';
import { toast } from '../ui/toast.js';

let state = { debt: null, payments: [] };
let el = null;

export async function load() {
  const { debt, payments } = await loadLoan();
  state.debt = debt;
  state.payments = payments;
}

/* Mounted by the shell whenever the modal opens. */
export function render(container) {
  el = container;
  if (!state.debt) {
    el.innerHTML = `<div class="soon"><div class="t">No loan on file</div>
      <div class="b">Nothing in the debts table yet. The seed adds the SoFi
      consolidation — see SETUP.md if this is unexpected.</div></div>`;
    return;
  }

  const debt = state.debt;
  const pos = position(debt, state.payments);
  const cmp = comparison(debt);
  const first = pd(debt.start_date);
  const monthlyCost = costOfOneMinimumMonth(debt);

  /* The next payment's split is taken at the CURRENT balance, so it stays
     honest as the loan is paid down rather than describing month one forever. */
  const next = splitPayment(pos.balance, debt.apr, debt.actual_payment);
  const nextShare = (next.principal / (next.principal + next.interest)) * 100;
  const paidOff = Number(debt.principal) - pos.balance;
  const progress = Number(debt.principal) ? (paidOff / Number(debt.principal)) * 100 : 0;

  const projectedPayoff = pos.cleared ? null
    : payoffDate(pos.started ? nextPaymentDate() : first, pos.remaining.count);

  el.innerHTML = `
    <div class="lhero">
      <div class="label">${esc(debt.name)}</div>
      <div class="n mono">${money(pos.balance)}</div>
      <div class="s">${Number(debt.apr).toFixed(2)}% APR with AutoPay · autopay set to
        ${money(debt.actual_payment)}/mo against a ${money(debt.minimum_payment)} minimum</div>
      <div class="track"><i style="width:${progress.toFixed(1)}%"></i></div>
      <div class="tends">
        <span>${pos.started ? `${pos.payments} payment${pos.payments === 1 ? '' : 's'} made` : `First payment ${fmtD(first)}, ${first.getFullYear()}`}</span>
        <span>${projectedPayoff ? `Projected payoff ${MFULL[projectedPayoff.getMonth()]} ${projectedPayoff.getFullYear()}` : 'Cleared'}</span>
      </div>
    </div>

    ${pos.started ? historyHTML(pos) : `
    <div class="panel" style="margin-bottom:13px">
      <div class="label" style="margin-bottom:9px">Nothing paid yet</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.7">
        The first payment posts <b style="color:var(--text)">${MFULL[first.getMonth()]} ${first.getDate()}</b>.
        Everything below is a projection from the loan terms — it becomes real history as
        payments are logged.
      </div>
    </div>`}

    <h2 class="sec">What ${money(debt.actual_payment)} a month buys you</h2>
    <div class="panel" style="padding:13px 4px 3px;overflow-x:auto">
      <table class="ctbl">
        <thead><tr><th>Paying</th><th>Payments</th><th>Payoff</th><th>Total interest</th></tr></thead>
        <tbody>
          <tr class="best">
            <td><div class="cn">${money(debt.actual_payment)} · your autopay</div>
              <div class="cs">what you set</div></td>
            <td class="mono">${cmp.actual.count}</td>
            <td class="mono">${monthYear(payoffDate(first, cmp.actual.count))}</td>
            <td class="mono">${money(cmp.actual.totalInterest)}</td>
          </tr>
          <tr>
            <td><div class="cn">${money(debt.minimum_payment)} · the minimum</div>
              <div class="cs">the floor, if a month goes badly</div></td>
            <td class="mono">${cmp.minimum.count}</td>
            <td class="mono">${monthYear(payoffDate(first, cmp.minimum.count))}</td>
            <td class="mono">${money(cmp.minimum.totalInterest)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="grid g3" style="margin:13px 0">
      <div class="panel stat"><div class="k mono">${money(cmp.interestAvoided)}</div>
        <div class="v">Interest avoided, if ${money(debt.actual_payment)} holds</div></div>
      <div class="panel stat"><div class="k mono">${cmp.monthsErased}</div>
        <div class="v">Months erased from the schedule</div></div>
      <div class="panel stat"><div class="k mono">${pos.payments} of ${cmp.actual.count}</div>
        <div class="v">Payments made</div></div>
    </div>

    <div class="panel">
      <div class="label">What the ${pos.started ? 'next' : 'first'} payment will look like</div>
      <div class="split">
        <div class="p" style="width:${nextShare.toFixed(0)}%">${money(next.principal)} principal</div>
        <div class="i" style="width:${(100 - nextShare).toFixed(0)}%">${money(next.interest)} interest</div>
      </div>
      <div class="srow">
        <span>${money(debt.actual_payment)} against ${money(pos.balance)}</span>
        <span>${nextShare.toFixed(0)}% principal</span>
      </div>
      <div class="note">
        At the ${money(debt.minimum_payment)} minimum the same payment would be
        ${minimumShare(pos.balance, debt)}% principal. The share going to principal climbs every
        month either way, and faster the more you pay. Dropping to the minimum for a single month
        costs roughly <b>${money(monthlyCost)}</b> in extra interest — the floor is there to be used.
      </div>
    </div>

    <div class="panel" style="margin-top:13px">
      <div class="label" style="margin-bottom:11px">Log a payment</div>
      <div class="ff" style="align-items:flex-end">
        <div class="fld"><span class="label">How much?</span>
          <div class="amtin"><span>$</span><input id="lpAmt" type="number" min="0" step="0.01"
            value="${Number(debt.actual_payment).toFixed(2)}" aria-label="Payment amount"></div></div>
        <div class="fld"><span class="label">Paid on</span>
          ${dateField('lpOn', { value: key(today()), label: 'Payment date' })}</div>
        <button class="go" id="lpSave">Log it</button>
      </div>
      <div class="fnote" style="border-top:0;padding-top:12px;margin-bottom:0">
        Splits at today's balance and stores both halves, so the record stays accurate even if
        the rate changes later. Once bills sync, ticking the SoFi bill in the week view will do
        this for you.
      </div>
    </div>`;

  wire();
}

function historyHTML(pos) {
  return `<div class="panel" style="margin-bottom:13px">
    <div class="label" style="margin-bottom:9px">Real history</div>
    <div class="lstats" style="grid-template-columns:repeat(3,1fr);border-top:0;padding-top:0">
      <div class="lstat"><div class="k mono">${money(pos.paid)}</div><div class="v">Paid so far</div></div>
      <div class="lstat"><div class="k mono g">${money(pos.principalPaid)}</div><div class="v">Off the principal</div></div>
      <div class="lstat"><div class="k mono">${money(pos.interestPaid)}</div><div class="v">Interest paid</div></div>
    </div>
    <div style="padding:3px 2px;margin-top:12px">
      ${state.payments.slice().reverse().map(p => `<div class="lrow">
        <span class="when">${fmtD(pd(p.paid_at))}</span>
        <span class="card">${money(p.amount)}<span class="sub"> · ${money(p.principal_portion)} principal / ${money(p.interest_portion)} interest</span></span>
        <button class="x" data-unpay="${p.id}" aria-label="Remove this payment" title="Remove">×</button>
      </div>`).join('')}
    </div>
  </div>`;
}

/* The month after the last payment made. */
function nextPaymentDate() {
  const last = state.payments[state.payments.length - 1];
  const d = pd(last.paid_at);
  return new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function minimumShare(balance, debt) {
  const s = splitPayment(balance, debt.apr, debt.minimum_payment);
  return Math.round((s.principal / (s.principal + s.interest)) * 100);
}

const monthYear = d => `${MFULL[d.getMonth()]} ${d.getFullYear()}`;
const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function wire() {
  const save = el.querySelector('#lpSave');
  if (save) save.onclick = async () => {
    const amount = parseFloat(el.querySelector('#lpAmt').value);
    if (!isFinite(amount) || amount <= 0) { toast('Enter the amount you paid'); return; }

    const pos = position(state.debt, state.payments);
    const split = splitPayment(pos.balance, state.debt.apr, amount);
    if (split.principal <= 0) {
      toast('That does not cover this month\'s interest — the balance would grow');
      return;
    }

    save.disabled = true;
    try {
      await logDebtPayment({
        debtId: state.debt.id, amount,
        paidAt: dateValue('lpOn') || key(today()),
        principal: split.principal, interest: split.interest,
      });
      await setDebtBalance(state.debt.id, pos.balance - split.principal);
      await load();
      render(el);
      toast(`Logged — ${money(split.principal)} off the principal`);
    } catch (err) {
      save.disabled = false;
      toast("Couldn't log that: " + err.message);
    }
  };

  el.querySelectorAll('[data-unpay]').forEach(b => b.onclick = async () => {
    try {
      await removeDebtPayment(b.dataset.unpay);
      await load();
      const pos = position(state.debt, state.payments);
      await setDebtBalance(state.debt.id, pos.balance);
      render(el);
      toast('Payment removed');
    } catch (err) { toast("Couldn't remove that: " + err.message); }
  });
}
