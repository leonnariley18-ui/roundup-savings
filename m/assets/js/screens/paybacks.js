/* Ledger mobile — Paybacks. */

import { today, add, key, pd, fmtD, money } from '../../../../assets/js/dates.js';
import { derive, summarise, clampPayment } from '../../../../assets/js/paybacks.js';
import { createPayback, addPayment, removeLastPayment, setPaybackStatus, logEvent } from '../../../../assets/js/data.js';
import { state } from '../state.js';
import { refetchAndRepaint } from '../shell.js';
import { toast } from '../toast.js';

let host = null;
let formOpen = false;
let expanded = new Set();

export async function mount(el) {
  host = el;
  render();
}

const cardFor = id => (state.cards || []).find(c => c.id === id) || null;

function derived() {
  const now = today();
  return (state.paybacks || []).map(p => derive(
    p,
    state.paymentsByPayback[p.id] || [],
    p.card_id ? cardFor(p.card_id) : null,
    p.card_id ? (state.closesByCard[p.card_id] || []) : [],
    now,
  ));
}

export function render() {
  if (!host) return;
  const all = derived();
  const live = all.filter(d => d.state !== 'became_bill');
  const s = summarise(all);
  const pc = v => (s.bar.total ? v / s.bar.total * 100 : 0);

  host.innerHTML = `
    <div class="mtopbar" style="padding-bottom:8px"><div class="mtitle">Paybacks</div></div>
    <div style="flex-shrink:0;padding:0 20px 0">
      <div class="pb-sbar">
        ${s.bar.paid ? `<span style="width:${pc(s.bar.paid)}%;background:var(--accent)"></span>` : ''}
        ${s.bar.late ? `<span style="width:${pc(s.bar.late)}%;background:var(--alert)"></span>` : ''}
        ${s.bar.soon ? `<span style="width:${pc(s.bar.soon)}%;background:var(--warn)"></span>` : ''}
        ${s.bar.easy ? `<span style="width:${pc(s.bar.easy)}%;background:var(--accent-2)"></span>` : ''}
      </div>
      <div class="pb-skey" style="padding:0 0 12px">
        ${s.bar.paid ? `<div class="mke"><i style="background:var(--accent)"></i>${money(s.bar.paid)} paid</div>` : ''}
        ${s.bar.late ? `<div class="mke"><i style="background:var(--alert)"></i>${money(s.bar.late)} urgent</div>` : ''}
        ${s.bar.soon ? `<div class="mke"><i style="background:var(--warn)"></i>${money(s.bar.soon)} this week</div>` : ''}
        ${s.bar.easy ? `<div class="mke"><i style="background:var(--accent-2)"></i>${money(s.bar.easy)} has room</div>` : ''}
      </div>
    </div>
    <button class="collapse-hdr" id="pbToggle">
      <span>Log a payback</span>
      <span class="collapse-ico${formOpen ? ' open' : ''}">${formOpen ? '×' : '＋'}</span>
    </button>
    <div class="pb-form${formOpen ? ' open' : ''}">
      <div class="frow"><div class="lbl">What was it?</div><input id="pbDesc" type="text" autocomplete="off"></div>
      <div class="frow-2">
        <div class="frow" style="margin-bottom:0"><div class="lbl">Amount</div><input id="pbAmt" type="number" inputmode="decimal" min="0" step="1"></div>
        <div class="frow" style="margin-bottom:0"><div class="lbl">Card / other</div><input id="pbCard" type="text" autocomplete="off" placeholder="leave blank if not a card"></div>
      </div>
      <button class="pb-btn" id="pbLog">Log it</button>
    </div>
    <div class="pb-scroll">
      ${live.length ? live.map(cardHTML).join('') : '<div class="msoon"><div class="t">Nothing fronted right now.</div></div>'}
    </div>`;

  wire();
}

function cardHTML(d) {
  const p = d.payback;
  const left = d.left, cleared = d.cleared;
  const isOpen = expanded.has(p.id);
  const daysLeft = d.offCard ? d.daysToTarget : d.daysToClose;
  const urgClass = cleared ? 'ok' : daysLeft < 3 ? 'bad' : daysLeft <= 7 ? 'warn' : 'ok';
  const urgText = cleared ? '✓ Paid off'
    : daysLeft < 0 ? 'Past your date'
    : daysLeft === 0 ? 'Closes today'
    : daysLeft === 1 ? '1 day to close'
    : daysLeft + ' days to close';
  const where = d.offCard ? (p.off_card_label || 'Not a card') : (d.card ? `${d.card.name} ···${d.card.last4}` : 'A card you no longer have');

  return `<div class="pb-card${!cleared && daysLeft < 3 ? ' urgent' : cleared ? ' cleared' : ''}">
    <div class="pc-top">
      <div class="pc-name">${esc(p.description)}</div>
      <div class="pc-left">${cleared ? 'Paid off' : money(left) + ' left'}</div>
    </div>
    ${cleared ? `<div class="pc-action" style="padding-bottom:10px">
        <button class="undo-btn" data-undopay="${p.id}">Undo</button>
        <button class="det-btn" style="margin-left:8px" data-toggledet="${p.id}"><span class="det-arr" style="transform:${isOpen ? 'rotate(180deg)' : ''}">▾</span> Details</button>
      </div>`
    : `<div class="pc-action">
        <div class="payinwrap"><span>$</span><input class="payin" id="pi-${p.id}" value="${left.toFixed(2)}" type="number" step="0.01" min="0" inputmode="decimal"></div>
        <button class="log-pay" data-pay="${p.id}">Paid</button>
        <button class="det-btn" data-toggledet="${p.id}"><span class="det-arr" style="transform:${isOpen ? 'rotate(180deg)' : ''}">▾</span> Details</button>
      </div>`}
    <div class="pc-detail${isOpen ? ' open' : ''}">
      <div class="pc-bar"><i style="width:${d.pct}%"></i></div>
      <div class="pc-metas">
        <div class="pc-meta-item">${d.offCard ? 'Where' : 'Card'}<b>${esc(where)}</b></div>
        <div class="pc-meta-item">Your target<b>${fmtD(pd(p.intended_payback_on))}</b></div>
        <div class="pc-meta-item">Total<b>${money(d.amount)}</b></div>
        ${d.paid > 0 ? `<div class="pc-meta-item">Paid so far<b>${money(d.paid)}</b></div>` : ''}
      </div>
      <div class="pc-foot">
        <span class="pc-urgency ${urgClass}">${urgText}</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--faint);font-variant-numeric:tabular-nums">${d.pct}% cleared</span>
      </div>
    </div>
  </div>`;
}

function wire() {
  const toggle = host.querySelector('#pbToggle');
  if (toggle) toggle.onclick = () => { formOpen = !formOpen; render(); if (formOpen) host.querySelector('#pbDesc')?.focus(); };

  const log = host.querySelector('#pbLog');
  if (log) log.onclick = async () => {
    const desc = host.querySelector('#pbDesc').value.trim();
    const amount = parseFloat(host.querySelector('#pbAmt').value);
    const cardInput = host.querySelector('#pbCard').value.trim();
    if (!desc) { toast('Give it a name'); return; }
    if (!isFinite(amount) || amount <= 0) { toast('Enter the amount'); return; }

    const matchedCard = (state.cards || []).find(c =>
      cardInput && (c.name.toLowerCase() === cardInput.toLowerCase() || c.last4 === cardInput.replace(/\D/g, '')));

    try {
      await createPayback({
        description: desc, amount,
        cardId: matchedCard ? matchedCard.id : null,
        offCardLabel: matchedCard ? null : (cardInput || null),
        incurredOn: key(today()),
        intendedOn: key(add(today(), 7)),
      });
      await refetchAndRepaint();
      formOpen = true;
      render();
      host.querySelector('#pbDesc')?.focus();
      toast('Logged — ' + desc);
    } catch (err) { toast("Couldn't save that: " + err.message); }
  };

  host.querySelectorAll('[data-toggledet]').forEach(b => b.onclick = () => {
    const id = b.dataset.toggledet;
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    render();
  });

  host.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => pay(b.dataset.pay));
  host.querySelectorAll('[data-undopay]').forEach(b => b.onclick = () => undoPay(b.dataset.undopay));
}

async function pay(id) {
  const d = derived().find(x => x.payback.id === id);
  const box = host.querySelector('#pi-' + id);
  const result = clampPayment(box && box.value, d.left);
  if (!result.ok) { toast('Enter the amount you paid'); return; }

  try {
    await addPayment(id, result.amount, key(today()));
    const nowPaid = d.paid + result.amount;
    const cleared = nowPaid >= d.amount - 0.005;
    if (cleared) {
      await setPaybackStatus(id, 'cleared');
      if (!d.offCard && d.daysToClose >= 0) {
        await logEvent('payback_cleared_before_close', {
          payback_id: id, amount: d.amount, card_id: d.payback.card_id, days_to_spare: d.daysToClose,
        });
      }
    }
    await refetchAndRepaint();
    if (result.clamped) toast('Only ' + money(result.amount) + ' was left — logged that');
    else if (cleared) toast('🎉 Paid off!');
    else toast(money(result.amount) + ' logged · ' + money(d.left - result.amount) + ' left');
  } catch (err) { toast("Couldn't log that: " + err.message); }
}

async function undoPay(id) {
  const payments = state.paymentsByPayback[id] || [];
  try {
    await removeLastPayment(id, payments);
    await setPaybackStatus(id, 'open');
    await refetchAndRepaint();
    toast('Removed');
  } catch (err) { toast("Couldn't undo that: " + err.message); }
}

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
