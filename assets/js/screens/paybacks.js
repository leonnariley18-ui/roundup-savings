/* Ledger — Paybacks
 *
 * The countdown runs to statement close, not to the payment due date. Clear it
 * before close and it never appears at all.
 *
 * Nothing here scolds. A passed date gets a quiet offer of a new one, not a
 * warning; a payback that became a bill stops nagging entirely, because there
 * is no action left to take.
 */

import { today, add, key, pd, fmtD, money } from '../dates.js';
import { derive, summarise, clampPayment } from '../paybacks.js';
import { loadCards, loadPaybacks, createPayback, addPayment, removeLastPayment,
         reschedulePayback, dismissPayback, setPaybackStatus, logEvent } from '../data.js';
import { calc } from '../statements.js';
import { dateField, onDateChange, dateValue, setDate } from '../ui/datepicker.js';
import { selectField, onSelectChange, selectValue } from '../ui/select.js';
import { toast } from '../ui/toast.js';
import { openHelp } from '../help.js';

let state = { cards: null, paybacks: [], paymentsByPayback: {}, lastDismissed: null };
let host = null;
let onChanged = () => {};

export function setChangeHandler(fn) { onChanged = fn; }

export async function mount(el) {
  host = el;
  host.innerHTML = '<div class="soon"><div class="t">Loading…</div></div>';
  try {
    await reload();
  } catch (err) {
    host.innerHTML = `<div class="soon"><div class="t">Couldn't load your paybacks</div>
      <div class="b">${err.message}</div></div>`;
  }
}

async function reload() {
  const [cards, pbs] = await Promise.all([loadCards(), loadPaybacks()]);
  state.cards = cards;
  state.paybacks = pbs.paybacks;
  state.paymentsByPayback = pbs.paymentsByPayback;
  render();
  onChanged();
}

const cardFor = id => state.cards.cards.find(c => c.id === id) || null;

function derived() {
  const now = today();
  return state.paybacks.map(p => derive(
    p,
    state.paymentsByPayback[p.id] || [],
    p.card_id ? cardFor(p.card_id) : null,
    p.card_id ? (state.cards.closesByCard[p.card_id] || []) : [],
    now,
  ));
}

/* ---------------------------------------------------------------- render */

function render() {
  const all = derived();
  const live = all.filter(d => d.state !== 'became_bill');
  const bills = all.filter(d => d.state === 'became_bill' && !d.payback.dismissed);
  const s = summarise(all);

  host.innerHTML = `
    <div class="helprow"><button class="qbtn" data-help="pb" aria-label="Why the countdown runs to statement close">?</button></div>

    <div class="grid g3" style="margin-bottom:14px">
      <div class="panel stat"><div class="k mono">${money(s.fronted)}</div><div class="v">Fronted right now</div></div>
      <div class="panel stat"><div class="k mono">${s.openCount}</div><div class="v">Open paybacks</div></div>
      <div class="panel stat"><div class="k mono" style="color:${s.closingSoon ? 'var(--alert)' : 'var(--text)'}">${s.closingSoon}</div>
        <div class="v">Closing within 3 days</div></div>
    </div>

    ${barHTML(s.bar)}
    <div class="pbform">${formHTML()}</div>
    <div id="pbopen">${live.length ? live.map(cardHTML).join('') : '<div class="panel empty">Nothing fronted right now.</div>'}</div>
    ${goneHTML(bills)}`;

  wire();
}

/* $400 outstanding is a different situation depending on how it splits, so the
 * header is a bar rather than a number. Segments render only when non-zero. */
function barHTML(bar) {
  if (!bar.total) return '';
  const pc = v => (v / bar.total * 100);
  return `
    <div class="sbar">
      ${bar.paid ? `<i class="s-paid" style="width:${pc(bar.paid)}%"></i>` : ''}
      ${bar.late ? `<i class="s-late" style="width:${pc(bar.late)}%"></i>` : ''}
      ${bar.soon ? `<i class="s-soon" style="width:${pc(bar.soon)}%"></i>` : ''}
      ${bar.easy ? `<i class="s-easy" style="width:${pc(bar.easy)}%"></i>` : ''}
    </div>
    <div class="skey">
      ${bar.paid ? `<span><i class="s-paid"></i>${money(bar.paid)} paid off</span>` : ''}
      ${bar.late ? `<span><i class="s-late"></i>${money(bar.late)} closing within 3 days</span>` : ''}
      ${bar.soon ? `<span><i class="s-soon"></i>${money(bar.soon)} closing this week</span>` : ''}
      ${bar.easy ? `<span><i class="s-easy"></i>${money(bar.easy)} with room</span>` : ''}
    </div>`;
}

/* Always on screen, never behind a button — the moment to log one of these is
 * the moment it happens, and a button in the way is enough friction to lose it. */
function formHTML() {
  const options = [
    ...state.cards.cards.map(c => [c.id, `${c.name} ···${c.last4}`]),
    ['other', 'Something else, not a card'],
  ];
  return `
    <div class="label" style="margin-bottom:15px">Log something you're planning to pay back</div>
    <div class="ff">
      <div class="fld grow"><span class="label">What was it?</span>
        <input id="pbD" type="text" autocomplete="off"></div>
      <div class="fld"><span class="label">How much?</span>
        <div class="amtin"><span>$</span><input id="pbA" type="number" min="0" step="1" placeholder="0"></div></div>
    </div>
    <div class="ff">
      <div class="fld grow"><span class="label">Where did it go?</span>
        ${selectField('pbC', options, options[0][0], 'Where the purchase went')}</div>
      <div class="fld grow" id="pbOtherWrap" hidden><span class="label">What was it, then?</span>
        <input id="pbOther" type="text" autocomplete="off" placeholder="Affirm, a friend, the tab at work…"></div>
      <div class="fld"><span class="label">Bought on</span>
        ${dateField('pbOn', { value: key(today()), label: 'Date bought' })}</div>
      <div class="fld"><span class="label">Meant to clear by</span>
        ${dateField('pbW', { value: key(add(today(), 7)), label: 'Target date' })}</div>
    </div>
    <div class="fnote" id="pbNote">${destinationNote(options[0][0])}</div>
    <div class="ff">
      <button class="go" id="pbSave">Log it</button>
      <button class="tbtn" id="pbClear">Clear the form</button>
    </div>`;
}

/* Live note under the destination — the whole point of choosing a card is
 * knowing how long you actually have. */
function destinationNote(value) {
  if (value === 'other') {
    return 'No statement to beat here — the only date that matters is the one you set. ' +
           'It stays open until you clear it.';
  }
  const card = cardFor(value);
  if (!card) return '';
  const t = calc(card, state.cards.closesByCard[card.id] || [], today());
  return `That card's statement closes <b>${t.certain ? '' : '~'}${fmtD(t.close)}</b> — ` +
    (t.daysToClose <= 0
      ? 'today or already past, so this lands on the current statement.'
      : `<b>${t.daysToClose} day${t.daysToClose === 1 ? '' : 's'}</b> to clear it before it becomes a bill.`);
}

function cardHTML(d) {
  const p = d.payback;
  const payLog = d.payments.length
    ? `<div class="paylog">${d.payments.map(x => fmtD(pd(x.paid_at)) + ' &middot; ' + money(x.amount)).join(' &nbsp;/&nbsp; ')}</div>`
    : '';

  if (d.cleared) {
    return `<div class="pb cleared">
      <div class="top"><div class="d">${esc(p.description)}</div><div class="a mono">${money(d.amount)}</div></div>
      <div class="l2">${destinationOf(d)} · cleared in full${
        d.payments.length > 1 ? ' over ' + d.payments.length + ' payments' : ''}</div>
      <div class="prog"><i style="width:100%"></i></div>
      <div class="bot">
        <span class="cd ok">\u{1F389} Paid off${d.offCard ? '' : ' — never hit the statement'}</span>
        <button class="sp" data-undopay="${p.id}">Undo last payment</button>
      </div>${payLog}</div>`;
  }

  const runway = d.offCard
    ? (d.daysToTarget < 0 ? 'your date has passed' : d.daysToTarget === 0 ? 'that’s today'
       : `${d.daysToTarget} day${d.daysToTarget === 1 ? '' : 's'} to go`)
    : (d.daysToClose === 0 ? 'closes today'
       : d.daysToClose < 3 ? `${d.daysToClose} day${d.daysToClose === 1 ? '' : 's'} until this becomes a bill`
       : `${d.daysToClose} days of runway`);

  return `<div class="pb ${d.offCard ? 'offcard' : ''}${!d.offCard && d.daysToClose < 3 ? ' late' : ''}">
    <div class="top">
      <div class="d">${esc(p.description)}</div>
      ${d.offCard ? '<span class="chip yours">Not a card</span>' : ''}
      <div class="a mono">${money(d.amount)}</div>
    </div>
    <div class="l2">${destinationOf(d)} · ${d.offCard ? 'owed since' : 'put on'} ${fmtD(pd(p.incurred_on))} · meant to clear by ${fmtD(pd(p.intended_payback_on))}${
      d.offCard ? ' · nothing closes on this, it just stays open'
                : ` · statement closes ${d.certain ? '' : '~'}${fmtD(d.closeDate)}`}</div>
    <div class="prog"><i style="width:${d.pct}%"></i></div>
    <div class="bot">
      <span>${money(d.paid)} of ${money(d.amount)} paid · <b style="color:var(--text)">${money(d.left)} left</b></span>
      <span class="cd ${d.urgency}">${runway}</span>
      <span class="sp payline">
        <span class="pfield"><span>$</span><input class="payin" id="pay-${p.id}" type="number" min="0" step="1"
          value="${d.left.toFixed(2)}" aria-label="Payment amount"></span>
        <button data-pay="${p.id}">Log payment</button>
      </span>
    </div>
    ${d.targetPassed ? `<div class="resched">
      <span>Want to give it a new date?</span>
      ${dateField('re-' + p.id, { value: key(today()), min: key(today()), label: 'New target date' })}
      <button class="tbtn" data-resched="${p.id}">Move it</button>
    </div>` : ''}
    ${payLog}</div>`;
}

/* Dimmed, and it stops nagging — there is no action left. Dismissing sets a
 * flag rather than deleting, because it is still on that bill either way. */
function goneHTML(bills) {
  const undo = state.lastDismissed
    ? `<div class="undo"><span>Dismissed “${esc(state.lastDismissed.description)}”</span>
        <button id="undoBtn">Undo</button></div>` : '';

  if (!bills.length) return undo;

  return `<h2 class="sec">Became bills</h2>${undo}
    ${bills.map(d => `<div class="pb gone">
      <div class="top">
        <div class="d">${esc(d.payback.description)}</div>
        <div class="a mono">${money(d.left)}</div>
        <button class="dismiss" data-dismiss="${d.payback.id}" aria-label="Dismiss" title="Dismiss">×</button>
      </div>
      <div class="l2">Landed on the ${fmtD(d.closeDate)} statement · now part of that bill</div>
    </div>`).join('')}`;
}

/* Which card it went on — or, off-card, whatever the user called it.
 *
 * The screen used to say only "Put on Aug 14", which in three weeks does not
 * tell you which card is about to absorb it, and "Not a card" did not say
 * whether that meant Affirm or a friend. */
function destinationOf(d) {
  if (!d.offCard) return d.card ? `${esc(d.card.name)} ···${d.card.last4}` : 'A card you no longer have';
  return d.payback.off_card_label ? esc(d.payback.off_card_label) : 'Not a card';
}

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/* ---------------------------------------------------------------- wiring */

function wire() {
  onSelectChange('pbC', value => {
    const note = host.querySelector('#pbNote');
    if (note) note.innerHTML = destinationNote(value);
    /* The free-text field only exists for off-card, where nothing else records
       what the thing actually was. */
    const wrap = host.querySelector('#pbOtherWrap');
    if (wrap) {
      wrap.hidden = value !== 'other';
      if (value === 'other') host.querySelector('#pbOther').focus();
    }
  });

  const save = host.querySelector('#pbSave');
  if (save) save.onclick = savePayback;
  const clear = host.querySelector('#pbClear');
  if (clear) clear.onclick = () => { render(); host.querySelector('#pbD').focus(); };

  host.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => pay(b.dataset.pay));
  host.querySelectorAll('[data-undopay]').forEach(b => b.onclick = () => undoPayment(b.dataset.undopay));
  host.querySelectorAll('[data-resched]').forEach(b => b.onclick = () => moveIt(b.dataset.resched));

  host.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = async () => {
    const p = state.paybacks.find(x => x.id === b.dataset.dismiss);
    try {
      await dismissPayback(p.id, true);
      p.dismissed = true;
      state.lastDismissed = p;
      render();
      toast('Dismissed — it stays on the bill');
    } catch (err) { toast("Couldn't dismiss that: " + err.message); }
  });

  const undo = host.querySelector('#undoBtn');
  if (undo) undo.onclick = async () => {
    const p = state.lastDismissed;
    try {
      await dismissPayback(p.id, false);
      p.dismissed = false;
      state.lastDismissed = null;
      render();
      toast('Restored');
    } catch (err) { toast("Couldn't restore that: " + err.message); }
  };

  const help = host.querySelector('[data-help]');
  if (help) help.onclick = () => openHelp('pb');
}

async function savePayback() {
  const description = host.querySelector('#pbD').value.trim();
  const amount = parseFloat(host.querySelector('#pbA').value);
  const dest = selectValue('pbC');

  if (!description) { toast('Give it a name so you know what it was'); return; }
  if (!isFinite(amount) || amount <= 0) { toast('Enter the amount you put on the card'); return; }

  try {
    await createPayback({
      description, amount,
      cardId: dest === 'other' ? null : dest,
      offCardLabel: dest === 'other' ? (host.querySelector('#pbOther')?.value.trim() || null) : null,
      incurredOn: dateValue('pbOn') || key(today()),
      intendedOn: dateValue('pbW') || key(add(today(), 7)),
    });
    await reload();
    /* Clears the form and returns to the first field, so a second one can be
       logged without reaching for the mouse. */
    host.querySelector('#pbD').focus();
    toast('Logged — ' + description);
  } catch (err) { toast("Couldn't save that: " + err.message); }
}

async function pay(id) {
  const d = derived().find(x => x.payback.id === id);
  const box = host.querySelector('#pay-' + id);
  const result = clampPayment(box && box.value, d.left);
  if (!result.ok) { toast('Enter the amount you paid'); return; }

  try {
    await addPayment(id, result.amount, key(today()));
    const nowPaid = d.paid + result.amount;
    const cleared = nowPaid >= d.amount - 0.005;

    if (cleared) {
      await setPaybackStatus(id, 'cleared');
      /* Only fires when it beat the close — that is the thing worth recording,
         and the future game layer reads exactly this. */
      if (!d.offCard && d.daysToClose >= 0) {
        await logEvent('payback_cleared_before_close', {
          payback_id: id, amount: d.amount, card_id: d.payback.card_id,
          days_to_spare: d.daysToClose,
        });
      }
    }

    await reload();
    if (result.clamped) toast('Only ' + money(result.amount) + ' was left — logged that');
    else if (cleared) toast('Paid off — ' + d.payback.description + ' never hits the statement');
    else toast(money(result.amount) + ' logged · ' + money(d.left - result.amount) + ' left');
  } catch (err) { toast("Couldn't log that: " + err.message); }
}

async function undoPayment(id) {
  const payments = state.paymentsByPayback[id] || [];
  try {
    await removeLastPayment(id, payments);
    await setPaybackStatus(id, 'open');
    await reload();
    toast('Payment removed');
  } catch (err) { toast("Couldn't undo that: " + err.message); }
}

async function moveIt(id) {
  const value = dateValue('re-' + id);
  const p = state.paybacks.find(x => x.id === id);
  if (!value) { toast('Pick a date'); return; }
  try {
    await reschedulePayback(id, value, p.moves);
    await reload();
    toast('Moved to ' + fmtD(pd(value)));
  } catch (err) { toast("Couldn't move that: " + err.message); }
}
