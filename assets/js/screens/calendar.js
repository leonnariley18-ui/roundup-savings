/* Ledger — Calendar, week view, day modal and notes
 *
 * The landing surface, because nearly everything this app tracks is a date
 * problem.
 *
 * Every day is clickable, including empty ones and days outside the month —
 * there is nowhere you can't open and jot a note. Notes live in the day modal
 * and nowhere else.
 */

import { today, add, mon, key, pd, isoWeek, fmtD, money, MN, MFULL, DW, dayIndex, isPayday } from '../dates.js';
import { buildIndex, eventsOn, eventsBetween, ORDER } from '../events.js';
import { loadCards, loadPaybacks, loadNotes, loadRoundupRuns, loadBills,
         addNote, updateNote, removeNote, removeRoundupRun } from '../data.js';
import { toast } from '../ui/toast.js';
import { setMastWord, goTab, openLoan } from '../shell.js';

/* Monday through Sunday. Thursday keeps the payday burgundy; the rest just
 * make each day feel like its own place rather than one grey box seven times. */
const DAYCOL = ['#cfb4f7', '#6982c7', '#e8b04b', '#c05070', '#9e379f', '#e8657f', '#8d85a2'];

let host = null;
let data = null;
let calMonth = new Date(today().getFullYear(), today().getMonth(), 1);
let weekAnchor = null;
let modalDay = null;
let editingNote = null;

export async function mount(el) {
  host = el;
  host.innerHTML = `<div id="calView"></div><div id="weekView" hidden></div>`;
  try {
    await reload();
  } catch (err) {
    host.innerHTML = `<div class="soon"><div class="t">Couldn't load the calendar</div>
      <div class="b">${err.message}</div></div>`;
  }
}

export async function reload() {
  const [cards, pbs, notes, runs, bills] = await Promise.all([
    loadCards(), loadPaybacks(), loadNotes(), loadRoundupRuns(), loadBills(),
  ]);
  data = { ...cards, ...pbs, notes, roundupRuns: runs, ...bills };
  repaint();
}

/* Rebuilds whichever surface is showing, without yanking the user out of it. */
function repaint() {
  const wv = document.getElementById('weekView');
  if (wv && !wv.hidden) renderWeek(); else renderMonth();
}

function indexFor(from, to) {
  return buildIndex(data, from, to, today());
}

const notesOn = k => (data.notes || []).filter(n => n.on_date === k);

/* ---------------------------------------------------------------- month */

function renderMonth() {
  document.getElementById('weekView').hidden = true;
  const view = document.getElementById('calView');
  view.hidden = false;

  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const gridStart = mon(first);
  const weeks = Math.ceil(((last - gridStart) / 864e5 + 1) / 7);
  const gridEnd = add(gridStart, weeks * 7 - 1);
  const index = indexFor(gridStart, gridEnd);
  const todayKey = key(today());
  const currentWeek = key(mon(today()));

  let rows = '';
  let cur = new Date(gridStart);
  for (let w = 0; w < weeks; w++) {
    const weekStart = new Date(cur);
    rows += `<button class="wknum${key(weekStart) === currentWeek ? ' cur' : ''}"
      data-wk="${key(weekStart)}" aria-label="Open week ${isoWeek(weekStart)}">
      <span class="w">wk</span><span class="n">${isoWeek(weekStart)}</span></button>`;

    for (let i = 0; i < 7; i++) {
      const d = new Date(cur), k = key(d);
      const outside = d.getMonth() !== m;
      const events = eventsOn(index, k);
      const billTotal = events.filter(e => e.type === 'bill').reduce((n, e) => n + e.amount, 0);

      const cls = ['cell'];
      if (outside) cls.push('out');
      if (k === todayKey) cls.push('today');
      if (isPayday(d)) cls.push('pay');

      /* Short bars, never circles — circles read as notification pips. */
      const pips = events.map(e => `<i style="background:${e.colour}"></i>`).join('');

      rows += `<button class="${cls.join(' ')}" data-day="${k}"
        aria-label="${MFULL[d.getMonth()]} ${d.getDate()}">
        <span class="n mono">${d.getDate()}</span>
        ${billTotal && !outside ? `<span class="amt">$${Math.round(billTotal).toLocaleString()}</span>` : ''}
        ${pips ? `<span class="pips">${pips}</span>` : ''}</button>`;
      cur = add(cur, 1);
    }
  }

  view.innerHTML = `
    <div class="chead">
      ${y === today().getFullYear() ? '' : `<h3>${y}</h3>`}
      <div class="nav">
        <button class="tbtn" id="calToday">Today</button>
        <button class="arrow" id="calPrev" aria-label="Previous month"><svg viewBox="0 0 12 12" fill="none"><path d="M7.5 2L3.5 6l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="arrow" id="calNext" aria-label="Next month"><svg viewBox="0 0 12 12" fill="none"><path d="M4.5 2l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </div>
    <div class="cgrid"><div></div>${DW.map(d => `<div class="dow">${d}</div>`).join('')}${rows}</div>
    <div class="legend">
      <span><i style="background:var(--accent)"></i>Bill due</span>
      <span><i style="background:var(--warn)"></i>Statement closes</span>
      <span><i style="background:var(--alert)"></i>Payback turns into a bill</span>
      <span><i style="background:var(--pbk)"></i>Your target to clear it</span>
      <span><i style="background:var(--loan)"></i>Loan payment</span>
      <span><i style="background:var(--save)"></i>Round-up moved</span>
      <span><i style="background:var(--muted)"></i>Note</span>
    </div>
    <div style="font-size:11px;color:var(--faint);margin-top:12px">Click a week number for the full week. Click any day to see it and jot a note.</div>`;

  /* The masthead carries the month, so there is no heading above the grid. */
  setMastWord(MFULL[m].toUpperCase());

  view.querySelector('#calPrev').onclick = () => { calMonth = new Date(y, m - 1, 1); renderMonth(); };
  view.querySelector('#calNext').onclick = () => { calMonth = new Date(y, m + 1, 1); renderMonth(); };
  view.querySelector('#calToday').onclick = () => {
    calMonth = new Date(today().getFullYear(), today().getMonth(), 1); renderMonth();
  };
  view.querySelectorAll('[data-wk]').forEach(b => b.onclick = () => openWeek(pd(b.dataset.wk)));
  view.querySelectorAll('[data-day]').forEach(b => b.onclick = () => openDay(b.dataset.day));
}

/* ---------------------------------------------------------------- week */

export function openWeek(anchor) {
  weekAnchor = mon(anchor);
  renderWeek();
}

function renderWeek() {
  document.getElementById('calView').hidden = true;
  const view = document.getElementById('weekView');
  view.hidden = false;

  const start = weekAnchor, end = add(start, 6);
  const index = indexFor(start, end);
  const todayKey = key(today());

  let strip = '';
  for (let i = 0; i < 7; i++) {
    const d = add(start, i), k = key(d);
    const total = eventsOn(index, k).filter(e => e.type === 'bill').reduce((n, e) => n + e.amount, 0);
    const cls = ['day'];
    if (i === 3) cls.push('pay');
    if (k === todayKey) cls.push('today');
    strip += `<div class="${cls.join(' ')}">
      <div class="dow">${DW[i]}</div><div class="num">${d.getDate()}</div>
      <div class="amt${total ? '' : ' none'}">${total ? '$' + Math.round(total).toLocaleString() : '—'}</div>
      ${i === 3 ? '<div class="pd">Payday</div>' : ''}</div>`;
  }

  const events = eventsBetween(index, start, end);
  const list = events.map(rowHTML).join('');

  view.innerHTML = `
    <div class="wkhead">
      <button class="back" id="wkBack"><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M7.5 2L3.5 6l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Calendar</button>
      <h3>Week ${isoWeek(start)}</h3>
      <span class="rng">${MN[start.getMonth()]} ${start.getDate()} – ${start.getMonth() === end.getMonth() ? '' : MN[end.getMonth()] + ' '}${end.getDate()}</span>
      <div class="nav">
        <button class="arrow" id="wkPrev" aria-label="Previous week"><svg viewBox="0 0 12 12" fill="none"><path d="M7.5 2L3.5 6l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="arrow" id="wkNext" aria-label="Next week"><svg viewBox="0 0 12 12" fill="none"><path d="M4.5 2l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </div>
    <div class="daybar">${strip}</div>
    <div class="panel" style="padding:3px 2px">${list || '<div class="empty">Nothing this week.</div>'}</div>
    <div class="summary">
      <div><div class="label">Still due</div><div class="big mono" id="wDue">$0.00</div></div>
      <div style="text-align:right"><div class="label">Already paid</div>
        <div class="big mono" style="color:var(--accent)" id="wPaid">$0.00</div></div>
    </div>`;

  setMastWord('WEEK ' + isoWeek(start));

  view.querySelector('#wkBack').onclick = () => renderMonth();
  view.querySelector('#wkPrev').onclick = () => { weekAnchor = add(weekAnchor, -7); renderWeek(); };
  view.querySelector('#wkNext').onclick = () => { weekAnchor = add(weekAnchor, 7); renderWeek(); };
  view.querySelectorAll('[data-noteday]').forEach(r => r.onclick = () => openDay(r.dataset.noteday));
  view.querySelectorAll('[data-gostmt]').forEach(r => r.onclick = () => goTab('stmt'));
  view.querySelectorAll('[data-goloan]').forEach(r => r.addEventListener('click', ev => {
    /* The row opens the loan; the checkbox and the amount field do not. */
    if (ev.target.closest('.tick') || ev.target.closest('.v')) return;
    openLoan();
  }));
  weekSummary();
}

function rowHTML(e) {
  const d = pd(e.date);
  const when = `<div class="when"><div class="d mono">${String(d.getDate()).padStart(2, '0')}</div>
    <div class="m">${MN[d.getMonth()]}</div></div>`;

  if (e.type === 'bill') {
    return `<div class="row${e.paid ? ' paid' : ''}${e.isLoan ? ' loanrow' : ''}"${e.isLoan ? ' data-goloan="1"' : ''}>
      <button class="tick" aria-label="Toggle paid"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6.2l2.6 2.6L10 3.4" stroke="#1a0f2b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      ${when}
      <div class="nm"><div class="n">${esc(e.label)}</div>
        <div class="t">${esc(e.sub)}${e.isLoan ? ' · click for the full picture' : ''}</div></div>
      <span class="chip ${e.isLoan ? 'loan' : 'auto'}">${e.isLoan ? 'The loan' : 'Bill'}</span>
      <input class="v" value="${e.amount.toFixed(2)}" aria-label="Amount"></div>`;
  }

  if (e.type === 'close') {
    return `<div class="row info closerow" data-gostmt="1" title="Open the statements tab">
      <div class="ic"><i style="background:var(--warn)"></i></div>${when}
      <div class="nm"><div class="n">${esc(e.label)}</div><div class="t">${esc(e.sub)} · click to log it</div></div>
      <span class="chip close">Closes</span><div style="width:98px"></div></div>`;
  }

  if (e.type === 'pbwant') {
    return `<div class="row info">
      <div class="ic"><i style="background:var(--pbk)"></i></div>${when}
      <div class="nm"><div class="n">${esc(e.label)}</div><div class="t">${esc(e.sub)}</div></div>
      <span class="chip yours">Your target</span>
      <div class="mono" style="width:98px;text-align:right">${money(e.amount)}</div></div>`;
  }

  if (e.type === 'roundup') {
    return `<div class="row info">
      <div class="ic"><i style="background:var(--save)"></i></div>${when}
      <div class="nm"><div class="n">${esc(e.label)}</div><div class="t">${esc(e.sub)}</div></div>
      <span class="chip save">Round-up</span><div style="width:98px"></div></div>`;
  }

  if (e.type === 'note') {
    return `<div class="row info noterow" data-noteday="${e.date}" title="Open this day">
      <div class="ic"><i style="background:var(--muted)"></i></div>${when}
      <div class="nm"><div class="n notetext">${esc(e.label)}</div><div class="t">Note · click to edit</div></div>
      <span class="chip est">Note</span><div style="width:98px"></div></div>`;
  }

  return `<div class="row info">
    <div class="ic"><i style="background:var(--alert)"></i></div>${when}
    <div class="nm"><div class="n">${esc(e.label)}</div><div class="t">${esc(e.sub)}</div></div>
    <span class="chip pbk">Payback</span>
    <div class="mono" style="width:98px;text-align:right;font-weight:600">${money(e.amount)}</div></div>`;
}

/* Read-only rows are excluded — only bills are money you tick off. */
function weekSummary() {
  let due = 0, paid = 0;
  document.querySelectorAll('#weekView .row:not(.info)').forEach(r => {
    const v = parseFloat(r.querySelector('.v')?.value) || 0;
    r.classList.contains('paid') ? paid += v : due += v;
  });
  const a = document.getElementById('wDue'), b = document.getElementById('wPaid');
  if (a) a.textContent = money(due);
  if (b) b.textContent = money(paid);
}

/* ---------------------------------------------------------------- day modal */

export function openDay(k) {
  modalDay = k;
  const d = pd(k);
  const index = indexFor(d, d);
  /* Notes render in their own section below, so they are filtered out here. */
  const events = eventsOn(index, k).filter(e => e.type !== 'note');

  const rows = events.map(e => `
    <div class="mrow${e.type === 'close' ? ' mlink" data-gostmt="1' : ''}">
      <span class="ic" style="background:${e.colour}"></span>
      <div class="mn"><div class="n">${esc(e.label)}</div>
        <div class="t">${esc(e.sub)}${e.type === 'close' ? ' · click to log it' : ''}</div></div>
      ${e.amount != null ? `<div class="mv">${money(e.amount)}</div>` : ''}
      ${e.type === 'roundup' ? `<button class="x" data-unru="${e.ref.run.id}" aria-label="Remove this round-up" title="Remove">×</button>` : ''}
    </div>`).join('');

  const billTotal = events.filter(e => e.type === 'bill' && !e.paid).reduce((n, e) => n + e.amount, 0);

  document.getElementById('modal').innerHTML = `
    <div class="mhead">
      <div class="dnum">${d.getDate()}</div>
      <div class="dmeta">
        <div class="dow" id="mTitle">${DW[dayIndex(d)]}</div>
        <div class="dfull">${MFULL[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · week ${isoWeek(d)}</div>
      </div>
      <button class="mclose" id="mX" aria-label="Close">×</button>
    </div>
    ${isPayday(d) ? '<div class="paydaybar">Payday</div>' : ''}
    <div class="mbody">${rows || '<div class="mnone">Nothing scheduled this day.</div>'}${notesBlock(k)}</div>
    <div class="mfoot">
      <button class="go" id="mWeek">Open week ${isoWeek(d)}</button>
      ${billTotal ? `<span style="font-size:12px;color:var(--muted);align-self:center">${money(billTotal)} still due this day</span>` : ''}
    </div>`;

  /* One variable tints the whole surface — background, header band, borders,
     dividers, hover states and buttons all derive from it. */
  document.getElementById('modal').style.setProperty('--acc', DAYCOL[dayIndex(d)]);
  document.getElementById('scrim').hidden = false;

  document.getElementById('mX').onclick = closeDay;
  document.getElementById('mWeek').onclick = () => { closeDay(); openWeek(d); };
  document.querySelectorAll('#modal [data-gostmt]').forEach(r => r.onclick = () => { closeDay(); goTab('stmt'); });
  document.querySelectorAll('#modal [data-unru]').forEach(b => b.onclick = async () => {
    try {
      await removeRoundupRun(b.dataset.unru);
      data.roundupRuns = data.roundupRuns.filter(r => r.id !== b.dataset.unru);
      openDay(k); repaint(); toast('Removed');
    } catch (err) { toast("Couldn't remove that: " + err.message); }
  });
  wireNotes(k);
}

export function closeDay() {
  const s = document.getElementById('scrim');
  if (s) s.hidden = true;
  modalDay = null;
  editingNote = null;
}

/* ---------------------------------------------------------------- notes */

function notesBlock(k) {
  const mine = notesOn(k);
  const rows = mine.map(n => {
    if (editingNote === n.id) {
      return `<div class="note-row editing">
        <textarea class="note-edit" data-editid="${n.id}" rows="2">${esc(n.body)}</textarea>
        <div class="note-acts">
          <button class="tbtn" data-savenote="${n.id}">Save</button>
          <button class="tbtn" data-cancelnote="1">Cancel</button></div></div>`;
    }
    return `<div class="note-row">
      <div class="note-body"><div class="note-t">${esc(n.body)}</div></div>
      <div class="note-acts">
        <button class="tbtn" data-editnote="${n.id}">Edit</button>
        <button class="tbtn" data-delnote="${n.id}">Delete</button></div></div>`;
  }).join('');

  return `<div class="notes-sec">
    <div class="label" style="margin-bottom:9px">Notes</div>
    ${rows}
    <div class="note-add">
      <textarea id="noteIn" rows="2" aria-label="New note"></textarea>
      <button class="go" id="noteAdd">Add</button>
    </div></div>`;
}

function wireNotes(k) {
  const box = document.getElementById('noteIn');
  if (!box) return;
  const addBtn = document.getElementById('noteAdd');

  addBtn.onclick = async () => {
    const body = box.value.trim();
    if (!body) { toast('Type something first'); return; }
    try {
      const row = await addNote(k, body);
      data.notes.push(row);
      editingNote = null;
      openDay(k); repaint(); toast('Noted');
    } catch (err) { toast("Couldn't save that: " + err.message); }
  };
  box.onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addBtn.click(); };

  document.querySelectorAll('#modal [data-editnote]').forEach(b => b.onclick = () => {
    editingNote = b.dataset.editnote;
    openDay(k);
    const f = document.querySelector('.note-edit');
    if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  });

  document.querySelectorAll('#modal [data-cancelnote]').forEach(b => b.onclick = () => {
    editingNote = null; openDay(k);
  });

  document.querySelectorAll('#modal [data-savenote]').forEach(b => b.onclick = async () => {
    const field = document.querySelector(`[data-editid="${b.dataset.savenote}"]`);
    const body = field ? field.value.trim() : '';
    if (!body) { toast('A note can’t be empty — delete it instead'); return; }
    try {
      await updateNote(b.dataset.savenote, body);
      const n = data.notes.find(x => x.id === b.dataset.savenote);
      if (n) n.body = body;
      editingNote = null;
      openDay(k); repaint(); toast('Saved');
    } catch (err) { toast("Couldn't save that: " + err.message); }
  });

  document.querySelectorAll('#modal [data-delnote]').forEach(b => b.onclick = async () => {
    try {
      await removeNote(b.dataset.delnote);
      data.notes = data.notes.filter(x => x.id !== b.dataset.delnote);
      editingNote = null;
      openDay(k); repaint(); toast('Deleted');
    } catch (err) { toast("Couldn't delete that: " + err.message); }
  });
}

const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
