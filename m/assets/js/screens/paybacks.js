/* Ledger mobile — Paybacks. */

import { today, add, key, pd, fmtD, money } from '../../../../assets/js/dates.js';
import { derive, summarise, clampPayment } from '../../../../assets/js/paybacks.js';
import { calc } from '../../../../assets/js/statements.js';
import { createPayback, addPayment, removeLastPayment, setPaybackStatus, logEvent } from '../../../../assets/js/data.js';
import { state } from '../state.js';
import { refetchAndRepaint } from '../shell.js';
import { toast } from '../toast.js';

let host = null;
let formOpen = false;
let expanded = new Set();
let formDest = null;
let formVals = { desc: '', amt: '', other: '', on: key(today()), want: key(add(today(), 7)) };

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
    <div class="pb-form${formOpen ? ' open' : ''}">${formHTML()}</div>
    <div class="pb-scroll">
      ${live.length ? live.map(cardHTML).join('') : '<div class="msoon"><div class="t">Nothing fronted right now.</div></div>'}
    </div>`;

  wire();
}

/* Same fields as desktop's screens/paybacks.js formHTML() — description,
 * amount, a real card/other destination (not free text), the live
 * days-to-close note under it, and both dates. Native select/date inputs
 * stand in for desktop's custom dpbtn/selbtn widgets — same fields and
 * behavior, mobile-appropriate controls. */
function formHTML() {
  const options = [
    ...(state.cards || []).map(c => [c.id, `${c.name} ···${c.last4}`]),
    ['other', 'Something else, not a card'],
  ];
  const cur = formDest || options[0][0];
  return `
    <div class="frow"><div class="lbl">What was it?</div><input id="pbDesc" type="text" autocomplete="off" value="${esc(formVals.desc)}"></div>
    <div class="frow-2">
      <div class="frow" style="margin-bottom:0"><div class="lbl">How much?</div><input id="pbAmt" type="number" inputmode="decimal" min="0" step="1" value="${formVals.amt}"></div>
      <div class="frow" style="margin-bottom:0"><div class="lbl">Where did it go?</div>
        <select id="pbDest" class="mselect">${options.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      </div>
    </div>
    ${cur === 'other' ? `<div class="frow"><div class="lbl">What was it, then?</div><input id="pbOther" type="text" autocomplete="off" placeholder="Affirm, a friend, the tab at work…" value="${esc(formVals.other)}"></div>` : ''}
    <div class="frow-2">
      <div class="frow" style="margin-bottom:0"><div class="lbl">Bought on</div><input id="pbOn" type="date" value="${formVals.on}"></div>
      <div class="frow" style="margin-bottom:0"><div class="lbl">Meant to clear by</div><input id="pbWant" type="date" value="${formVals.want}"></div>
    </div>
    <div class="fnote" style="font-family:var(--sans);font-size:12px;color:var(--faint);line-height:1.6;margin-bottom:12px">${destinationNote(cur)}</div>
    <button class="pb-btn" id="pbLog">Log it</button>`;
}

/* Same note desktop shows under the destination — the whole point of
 * choosing a card is knowing how long you actually have. */
function destinationNote(value) {
  if (value === 'other') {
    return 'No statement to beat here — the only date that matters is the one you set. It stays open until you clear it.';
  }
  const card = cardFor(value);
  if (!card) return '';
  const t = calc(card, state.closesByCard[card.id] || [], today());
  return `That card's statement closes <b>${t.certain ? '' : '~'}${fmtD(t.close)}</b> — ` +
    (t.daysToClose <= 0
      ? 'today or already past, so this lands on the current statement.'
      : `<b>${t.daysToClose} day${t.daysToClose === 1 ? '' : 's'}</b> to clear it before it becomes a bill.`);
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

  const desc = host.querySelector('#pbDesc');
  if (desc) desc.oninput = () => { formVals.desc = desc.value; };
  const amt = host.querySelector('#pbAmt');
  if (amt) amt.oninput = () => { formVals.amt = amt.value; };
  const other = host.querySelector('#pbOther');
  if (other) other.oninput = () => { formVals.other = other.value; };
  const on = host.querySelector('#pbOn');
  if (on) on.onchange = () => { formVals.on = on.value; };
  const want = host.querySelector('#pbWant');
  if (want) want.onchange = () => { formVals.want = want.value; };
  const dest = host.querySelector('#pbDest');
  if (dest) dest.onchange = () => { formDest = dest.value; render(); host.querySelector('#pbDesc')?.focus(); };

  const log = host.querySelector('#pbLog');
  if (log) log.onclick = async () => {
    const description = formVals.desc.trim();
    const amount = parseFloat(formVals.amt);
    const destVal = formDest || (state.cards || [])[0]?.id || 'other';
    if (!description) { toast('Give it a name so you know what it was'); return; }
    if (!isFinite(amount) || amount <= 0) { toast('Enter the amount you put on the card'); return; }

    try {
      await createPayback({
        description, amount,
        cardId: destVal === 'other' ? null : destVal,
        offCardLabel: destVal === 'other' ? (formVals.other.trim() || null) : null,
        incurredOn: formVals.on || key(today()),
        intendedOn: formVals.want || key(add(today(), 7)),
      });
      await refetchAndRepaint();
      formOpen = true;
      formVals = { desc: '', amt: '', other: '', on: key(today()), want: key(add(today(), 7)) };
      formDest = null;
      render();
      host.querySelector('#pbDesc')?.focus();
      toast('Logged — ' + description);
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
