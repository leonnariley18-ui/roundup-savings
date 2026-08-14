/* Ledger — date picker
 *
 * Custom because the native control takes the OS's appearance, not the app's.
 * No <input type="date"> anywhere in this app.
 *
 * The prototype wired its call sites by name inside the picker itself
 * (`if (id === 'when') { ... }`), which meant the component knew about every
 * screen that used it. Here a call site registers a handler instead, so the
 * picker knows nothing about its callers and new ones cost no edit to this file.
 *
 * Fields render as HTML strings rather than mounted objects because the rest of
 * the app repaints by assigning innerHTML. Handlers are keyed by element id and
 * survive that repaint, so a re-render does not have to re-register anything.
 */

import { mon, add, key, pd, today, DW, MFULL, fmtDW } from '../dates.js';

const handlers = new Map();
let open = null;      // the .dpbtn whose popup is showing
let view = null;      // the month that popup is displaying

/* Returns the field's markup. `min` disables earlier days outright rather than
 * accepting a date and then rejecting it — the constraint should be visible
 * before the click, not explained after it. */
export function dateField(id, { value, min = '', label = 'Pick a date' } = {}) {
  const v = value || key(today());
  return `<div class="dpwrap"><button type="button" class="dpbtn" id="${id}" data-val="${v}"` +
    (min ? ` data-min="${min}"` : '') +
    ` aria-label="${label}" aria-haspopup="dialog">` +
    `<span>${fmtDW(pd(v))}</span><span class="dpi" aria-hidden="true">&#9662;</span></button></div>`;
}

export const dateValue = id => document.getElementById(id)?.dataset.val || null;

export function onDateChange(id, fn) { handlers.set(id, fn); }

export function setDate(id, k) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.dataset.val = k;
  btn.querySelector('span').textContent = fmtDW(pd(k));
}

export function closePicker() {
  document.querySelectorAll('.dppop').forEach(p => p.remove());
  if (open) open.setAttribute('aria-expanded', 'false');
  open = null;
}

function toggle(btn) {
  if (open === btn) { closePicker(); return; }
  closePicker();
  open = btn;
  btn.setAttribute('aria-expanded', 'true');
  view = pd(btn.dataset.val);
  view.setDate(1);
  paint();
}

function paint() {
  const btn = open;
  if (!btn) return;
  btn.parentNode.querySelectorAll('.dppop').forEach(p => p.remove());

  const sel = btn.dataset.val;
  const min = btn.dataset.min ? pd(btn.dataset.min) : null;
  const y = view.getFullYear(), m = view.getMonth();
  const start = mon(new Date(y, m, 1));
  const last = new Date(y, m + 1, 0);
  const weeks = Math.ceil((((last - start) / 864e5) + 1) / 7);
  const now = key(today());

  let cells = '', cur = new Date(start);
  for (let i = 0; i < weeks * 7; i++) {
    const k = key(cur);
    const cls = ['dpd'];
    if (cur.getMonth() !== m) cls.push('out');
    if (k === sel) cls.push('sel');
    if (k === now) cls.push('now');
    const disabled = min && cur < min;
    cells += `<button type="button" class="${cls.join(' ')}"` +
      (disabled ? ' disabled' : ` data-pick="${k}"`) +
      `>${cur.getDate()}</button>`;
    cur = add(cur, 1);
  }

  /* The Today shortcut disappears when today is out of range, for the same
     reason the days do — never offer a click that is going to be refused. */
  const todayAllowed = !min || pd(now) >= min;

  const pop = document.createElement('div');
  pop.className = 'dppop';
  pop.setAttribute('role', 'dialog');
  pop.innerHTML = `
    <div class="dphead">
      <button type="button" class="arrow" data-dpm="-1" aria-label="Previous month">&lsaquo;</button>
      <span class="dpm">${MFULL[m]} ${y}</span>
      <button type="button" class="arrow" data-dpm="1" aria-label="Next month">&rsaquo;</button>
    </div>
    <div class="dpdow">${DW.map(d => `<span>${d[0]}</span>`).join('')}</div>
    <div class="dpgrid">${cells}</div>
    ${todayAllowed ? `<div class="dpfoot"><button type="button" class="tbtn" data-pick="${now}">Today</button></div>` : ''}`;
  btn.parentNode.appendChild(pop);
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.dpbtn');
  if (btn) { e.preventDefault(); toggle(btn); return; }

  const nav = e.target.closest('[data-dpm]');
  if (nav && open) {
    view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.dpm), 1);
    paint();
    return;
  }

  const pick = e.target.closest('.dppop [data-pick]');
  if (pick && open) {
    const btn2 = open, k = pick.dataset.pick;
    const id = btn2.id;
    setDate(id, k);
    closePicker();
    handlers.get(id)?.(k);
    return;
  }

  if (open && !e.target.closest('.dppop')) closePicker();
});

/* Escape closes the picker and stops there — it must not also close the modal
   the picker is sitting inside, which is where most of these live. */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && open) {
    e.stopPropagation();
    const btn = open;
    closePicker();
    btn.focus();
  }
}, true);
