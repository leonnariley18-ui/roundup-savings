/* Ledger — Paybacks
 *
 * The countdown runs to statement close, not to the payment due date. Clear it
 * before close and it never appears at all.
 *
 * Three tabs — Current, Became bill, Cleared — because those are three
 * different things you can do: log a payment, mark paid or dismiss, and
 * just look at what's done. The stat row and split bar above them always
 * reflect the same totals regardless of which tab is open; only the list
 * changes.
 *
 * Rows collapse to one line and expand on click, in a bounded scrolling
 * list, so a long history doesn't run the whole page long.
 */

import { today, add, key, pd, fmtD, money } from '../dates.js';
import { derive, summarise, clampPayment } from '../paybacks.js';
import { loadCards, loadPaybacks, loadDecisions, createPayback, addPayment, removeLastPayment,
         reschedulePayback, dismissPayback, setPaybackStatus, logEvent,
         linkDecisionToPayback, unlinkDecision } from '../data.js';
import { calc } from '../statements.js';
import { dateField, onDateChange, dateValue, setDate } from '../ui/datepicker.js';
import { selectField, onSelectChange, selectValue } from '../ui/select.js';
import { toast } from '../ui/toast.js';
import { openHelp } from '../help.js';

let state = { cards: null, paybacks: [], paymentsByPayback: {}, decisions: [] };
let host = null;
let onChanged = () => {};
let tab = 'current';
let expanded = new Set();

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
  const [cards, pbs, decisions] = await Promise.all([loadCards(), loadPaybacks(), loadDecisions()]);
  state.cards = cards;
  state.paybacks = pbs.paybacks;
  state.paymentsByPayback = pbs.paymentsByPayback;
  state.decisions = decisions;
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
  const s = summarise(all);

  const current = all.filter(d => d.state === 'open');
  const gone = all.filter(d => d.state === 'became_bill' && !d.payback.dismissed);
  const dismissed = all.filter(d => d.state === 'became_bill' && d.payback.dismissed);
  const cleared = all.filter(d => d.state === 'cleared');

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

    <div class="pbtabs">
      <button class="pbtab${tab === 'current' ? ' on' : ''}" data-tab="current">Current<span class="n">${current.length}</span></button>
      <button class="pbtab${tab === 'gone' ? ' on' : ''}" data-tab="gone">Became bill<span class="n">${gone.length}</span></button>
      <button class="pbtab${tab === 'cleared' ? ' on' : ''}" data-tab="cleared">Cleared<span class="n">${cleared.length}</span></button>
    </div>
    <div class="pblist" id="pblist">${listHTML(current, gone, dismissed, cleared)}</div>`;

  wire();
}

function listHTML(current, gone, dismissed, cleared) {
  if (tab === 'current') {
    return current.length ? current.map(currentRowHTML).join('')
      : '<div class="pbempty">Nothing fronted right now.</div>';
  }
  if (tab === 'gone') {
    if (!gone.length && !dismissed.length) return '<div class="pbempty">Nothing here — every payback either cleared or is still open.</div>';
    return gone.map(goneRowHTML).join('') +
      (dismissed.length ? `<div class="pbsublbl">Dismissed</div>${dismissed.map(dismissedRowHTML).join('')}` : '');
  }
  return cleared.length ? cleared.map(clearedRowHTML).join('')
    : '<div class="pbempty">Nothing cleared yet.</div>';
}

/* $400 outstanding is a different situation depending on how it splits, so the
 * header is a bar rather than a number. Segments render only when non-zero.
 * Became-bill amounts never enter this — see summarise() in paybacks.js. */
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

/* ---------------------------------------------------------------- rows */

function headHTML(d, label, urgClass) {
  const id = d.payback.id;
  return `<div class="pb-head" data-toggle="${id}">
    <span class="chev">▸</span>
    <div class="d">${esc(d.payback.description)}</div>
    <span class="urg ${urgClass}">${label}</span>
    <div class="a mono">${money(d.amount)}</div>
  </div>`;
}

/* A card decision and a payback are separate things — a rewards choice vs.
 * money being fronted — that sometimes turn out to be the same purchase.
 * Linking is optional and always after the fact, from here only; nothing
 * about logging a card decision changes. */
function linkedDecisionsHTML(paybackId) {
  const linked = state.decisions.filter(d => d.payback_id === paybackId);
  const unlinked = state.decisions.filter(d => !d.payback_id);

  const linkedRows = linked.map(d => {
    const card = cardFor(d.card_id);
    return `<div class="payrow" style="color:var(--muted)">
      <span class="pdate">${fmtD(new Date(d.decided_at))}</span>
      <span style="flex:1">${card ? esc(card.name) : 'a card you no longer have'} · ${esc(cat(d.category))}</span>
      <button data-unlink-decision="${d.id}" style="background:transparent;border:0;color:var(--faint);cursor:pointer;font-size:15px;line-height:1;padding:0 4px;font-family:var(--mono)">×</button>
    </div>`;
  }).join('');

  const picker = unlinked.length ? `<div style="display:flex;gap:8px;align-items:center;margin-top:${linked.length ? 8 : 0}px">
    <select class="mselect" id="declink-${paybackId}" style="flex:1;background:transparent;border:0;border-bottom:1.5px solid var(--line);color:var(--muted);font-family:var(--mono);font-size:12px;padding:4px 2px">
      ${unlinked.map(d => `<option value="${d.id}">${fmtD(new Date(d.decided_at))} · ${cardFor(d.card_id)?.name || '?'} · ${cat(d.category)}</option>`).join('')}
    </select>
    <button data-link-decision="${paybackId}">Link a card decision</button>
  </div>` : '';

  if (!linked.length && !picker) return '';
  return `<div class="paylog" style="color:inherit">
    <div class="lbl" style="color:var(--faint)">Card decision</div>
    ${linkedRows}${picker}
  </div>`;
}

const cat = c => c ? c.charAt(0).toUpperCase() + c.slice(1) : '';

function paylogHTML(payments) {
  if (!payments || !payments.length) return '';
  return `<div class="paylog">
    <div class="lbl">Payment history</div>
    ${payments.map(p => `<div class="payrow"><span class="pdate">${fmtD(pd(p.paid_at))}</span><span class="pamt">${money(p.amount)}</span></div>`).join('')}
  </div>`;
}

function currentRowHTML(d) {
  const p = d.payback;
  const id = p.id;
  const isOpen = expanded.has(id);
  const runway = d.offCard
    ? (d.daysToTarget < 0 ? 'past your date' : d.daysToTarget === 0 ? 'that’s today'
       : `${d.daysToTarget} day${d.daysToTarget === 1 ? '' : 's'} to go`)
    : (d.daysToClose === 0 ? 'closes today'
       : d.daysToClose < 3 ? `${d.daysToClose} day${d.daysToClose === 1 ? '' : 's'} to close`
       : `${d.daysToClose} days of runway`);
  const urgClass = d.daysToClose != null && d.daysToClose < 3 ? 'late' : 'ok';

  return `<div class="pb${urgClass === 'late' ? ' late' : ''}${d.offCard ? ' offcard' : ''}${isOpen ? ' open' : ''}">
    ${headHTML(d, runway, urgClass)}
    <div class="pb-body">
      <div class="l2">${destinationOf(d)} · ${d.offCard ? 'owed since' : 'put on'} ${fmtD(pd(p.incurred_on))} · meant to clear by ${fmtD(pd(p.intended_payback_on))}${
        d.offCard ? ' · nothing closes on this, it just stays open'
                  : ` · statement closes ${d.certain ? '' : '~'}${fmtD(d.closeDate)}`}</div>
      <div class="prog"><i style="width:${d.pct}%"></i></div>
      <div class="bot">
        <span>${money(d.paid)} of ${money(d.amount)} paid · <b style="color:var(--text)">${money(d.left)} left</b></span>
        <span class="sp payline">
          <span class="pfield"><span>$</span><input class="payin" id="pay-${id}" type="number" min="0" step="1"
            value="${d.left.toFixed(2)}" aria-label="Payment amount"></span>
          <button data-pay="${id}">Log payment</button>
        </span>
      </div>
      ${d.targetPassed ? `<div class="resched">
        <span>Want to give it a new date?</span>
        ${dateField('re-' + id, { value: key(today()), min: key(today()), label: 'New target date' })}
        <button class="tbtn" data-resched="${id}">Move it</button>
      </div>` : ''}
      ${paylogHTML(d.payments)}
      ${linkedDecisionsHTML(id)}
    </div>
  </div>`;
}

function goneRowHTML(d) {
  const p = d.payback;
  const id = p.id;
  const isOpen = expanded.has(id);
  return `<div class="pb gone${isOpen ? ' open' : ''}">
    ${headHTML(d, 'Became a bill', 'gone')}
    <div class="pb-body">
      <div class="l2">Landed on the ${fmtD(d.closeDate)} statement · now part of that bill</div>
      ${paylogHTML(d.payments)}
      <div class="bot">
        <button data-markpaid="${id}">Mark paid</button>
        <button data-dismiss="${id}">Dismiss</button>
      </div>
      ${linkedDecisionsHTML(id)}
    </div>
  </div>`;
}

/* Dismissed but never lost — folded to the bottom of Became bill, faded,
 * with its own permanent Restore rather than a one-shot undo that vanishes
 * on reload. */
function dismissedRowHTML(d) {
  const id = d.payback.id;
  const isOpen = expanded.has(id);
  return `<div class="pb gone dismissed${isOpen ? ' open' : ''}">
    ${headHTML(d, 'Dismissed', 'gone')}
    <div class="pb-body">
      <div class="l2">Landed on the ${fmtD(d.closeDate)} statement · now part of that bill</div>
      ${paylogHTML(d.payments)}
      <div class="bot">
        <button data-restore="${id}">Restore</button>
      </div>
    </div>
  </div>`;
}

function clearedRowHTML(d) {
  const p = d.payback;
  const id = p.id;
  const isOpen = expanded.has(id);
  return `<div class="pb cleared${isOpen ? ' open' : ''}">
    ${headHTML(d, '🎉 Paid off' + (d.manuallyPaid ? ' · via statement' : ''), 'won')}
    <div class="pb-body">
      <div class="l2">${destinationOf(d)} · ${d.manuallyPaid ? 'marked paid — settled as part of a statement, not tracked here'
        : `cleared in full${d.payments.length > 1 ? ' over ' + d.payments.length + ' payments' : ''}`}</div>
      <div class="prog"><i style="width:100%"></i></div>
      <div class="bot">
        ${d.manuallyPaid ? `<button data-unmark="${id}">Unmark paid</button>`
          : `<button data-undopay="${id}">Undo last payment</button>`}
      </div>
      ${paylogHTML(d.payments)}
      ${linkedDecisionsHTML(id)}
    </div>
  </div>`;
}

/* Which card it went on — or, off-card, whatever the user called it. */
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

  host.querySelectorAll('.pbtab').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });

  host.querySelectorAll('[data-toggle]').forEach(h => h.onclick = () => {
    const id = h.dataset.toggle;
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    render();
  });

  host.querySelectorAll('[data-pay]').forEach(b => b.onclick = e => { e.stopPropagation(); pay(b.dataset.pay); });
  host.querySelectorAll('[data-undopay]').forEach(b => b.onclick = e => { e.stopPropagation(); undoPayment(b.dataset.undopay); });
  host.querySelectorAll('[data-resched]').forEach(b => b.onclick = e => { e.stopPropagation(); moveIt(b.dataset.resched); });
  host.querySelectorAll('[data-markpaid]').forEach(b => b.onclick = e => { e.stopPropagation(); markPaid(b.dataset.markpaid); });
  host.querySelectorAll('[data-unmark]').forEach(b => b.onclick = e => { e.stopPropagation(); unmarkPaid(b.dataset.unmark); });

  host.querySelectorAll('[data-link-decision]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const paybackId = b.dataset.linkDecision;
    const sel = host.querySelector('#declink-' + paybackId);
    const decisionId = sel && sel.value;
    if (!decisionId) { toast('Nothing to link'); return; }
    try {
      await linkDecisionToPayback(decisionId, paybackId);
      await reload();
      toast('Linked');
    } catch (err) { toast("Couldn't link that: " + err.message); }
  });

  host.querySelectorAll('[data-unlink-decision]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    try {
      await unlinkDecision(b.dataset.unlinkDecision);
      await reload();
      toast('Unlinked');
    } catch (err) { toast("Couldn't unlink that: " + err.message); }
  });

  host.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const p = state.paybacks.find(x => x.id === b.dataset.dismiss);
    try {
      await dismissPayback(p.id, true);
      p.dismissed = true;
      render();
      toast('Dismissed — folded to the bottom of Became bill');
    } catch (err) { toast("Couldn't dismiss that: " + err.message); }
  });

  host.querySelectorAll('[data-restore]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const p = state.paybacks.find(x => x.id === b.dataset.restore);
    try {
      await dismissPayback(p.id, false);
      p.dismissed = false;
      render();
      toast('Restored');
    } catch (err) { toast("Couldn't restore that: " + err.message); }
  });

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

/* Records that the statement got paid without inventing a payment amount —
 * see derive() in paybacks.js. Moves it to Cleared. */
async function markPaid(id) {
  try {
    await setPaybackStatus(id, 'paid');
    await reload();
    toast('Marked paid');
  } catch (err) { toast("Couldn't mark that: " + err.message); }
}

async function unmarkPaid(id) {
  try {
    await setPaybackStatus(id, 'open');
    await reload();
    toast('Back to became bill');
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
