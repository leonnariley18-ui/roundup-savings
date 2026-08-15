/* Ledger — select
 *
 * Same reasoning as the date picker: the native dropdown belongs to the OS, not
 * the app. No <select> anywhere either.
 *
 * Options ride on the element as an encoded data attribute so a field survives
 * the innerHTML repaints the rest of the app does, and handlers are registered
 * by id exactly as with the picker.
 */

const handlers = new Map();
let open = null;

export function selectField(id, opts, value, label = '') {
  const cur = opts.find(o => o[0] === value) || opts[0];
  return `<div class="selwrap"><button type="button" class="selbtn" id="${id}" data-val="${cur[0]}"` +
    ` data-opts="${encodeURIComponent(JSON.stringify(opts))}" aria-haspopup="listbox"` +
    ` aria-expanded="false" aria-label="${label}">` +
    `<span>${cur[1]}</span><span class="dpi" aria-hidden="true">&#9662;</span></button></div>`;
}

export const selectValue = id => document.getElementById(id)?.dataset.val || null;

export function onSelectChange(id, fn) { handlers.set(id, fn); }

export function closeSelect() {
  document.querySelectorAll('.selpop').forEach(p => p.remove());
  if (open) open.setAttribute('aria-expanded', 'false');
  open = null;
}

function toggle(btn) {
  if (open === btn) { closeSelect(); return; }
  closeSelect();
  open = btn;
  btn.setAttribute('aria-expanded', 'true');

  const opts = JSON.parse(decodeURIComponent(btn.dataset.opts));
  const pop = document.createElement('div');
  pop.className = 'selpop';
  pop.setAttribute('role', 'listbox');
  pop.innerHTML = opts.map(([k, l]) =>
    `<button type="button" class="selo${k === btn.dataset.val ? ' on' : ''}"` +
    ` data-opt="${k}" role="option" aria-selected="${k === btn.dataset.val}">${l}</button>`).join('');
  btn.parentNode.appendChild(pop);
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.selbtn');
  if (btn) { e.preventDefault(); toggle(btn); return; }

  const opt = e.target.closest('.selpop [data-opt]');
  if (opt && open) {
    const btn2 = open, id = btn2.id;
    btn2.dataset.val = opt.dataset.opt;
    btn2.querySelector('span').textContent = opt.textContent;
    closeSelect();
    handlers.get(id)?.(opt.dataset.opt, opt.textContent);
    return;
  }

  if (open && !e.target.closest('.selpop')) closeSelect();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && open) {
    e.stopPropagation();
    const btn = open;
    closeSelect();
    btn.focus();
  }
}, true);
