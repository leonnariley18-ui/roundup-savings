/* Ledger mobile — shell: five-tab nav, screen switching, and the day sheet.
 *
 * The day sheet is the one component shared by the week view and the
 * calendar — same weekday-accent-colour behaviour as desktop's day modal
 * (screens/calendar.js), just as a bottom sheet instead of a centred modal.
 */

import { pd, MFULL, DW, dayIndex, isoWeek } from '../../../assets/js/dates.js';
import { eventsOn } from '../../../assets/js/events.js';
import { addNote, updateNote, removeNote } from '../../../assets/js/data.js';
import { state, indexFor, reload } from './state.js';
import { toast } from './toast.js';

/* Monday through Sunday — identical to desktop's DAYCOL in screens/calendar.js,
 * and to the spec's per-weekday day-sheet table. One variable tints the whole
 * sheet: background, numeral, and the Add-note button all derive from it. */
const DAYACC = ['#cfb4f7', '#6982c7', '#e8b04b', '#c05070', '#9e379f', '#e8657f', '#8d85a2'];

const screens = {};
let activeScreen = 'week';
let sheetKey = null;
let editingNote = null;

export function registerScreen(name, mod) { screens[name] = mod; }

export async function initShell() {
  document.querySelectorAll('.ni').forEach(b => {
    b.addEventListener('click', () => switchTo(b.dataset.s));
  });
  document.getElementById('msheet-scrim').onclick = closeSheet;
  document.getElementById('msh-close').onclick = closeSheet;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  for (const name of Object.keys(screens)) {
    await screens[name].mount(document.getElementById('s-' + name));
  }
  switchTo('week');
}

function switchTo(name) {
  if (!screens[name]) return;
  activeScreen = name;
  document.querySelectorAll('.ni').forEach(n => n.classList.toggle('on', n.dataset.s === name));
  document.querySelectorAll('.mscreen').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + name).classList.add('active');
  screens[name].render();
}

/* Called after any mutation so every tab's next view is current — same as
 * desktop's calendar.reload()/repaint() pattern. */
export function repaintAll() {
  Object.values(screens).forEach(s => s.render());
}

export async function refetchAndRepaint() {
  await reload();
  repaintAll();
}

/* ---------------------------------------------------------------- day sheet */

export function openSheet(k) {
  sheetKey = k;
  editingNote = null;
  paintSheet();
  document.getElementById('msheet-scrim').classList.add('show');
  document.getElementById('mday-sheet').classList.add('show');
}

export function closeSheet() {
  document.getElementById('msheet-scrim').classList.remove('show');
  document.getElementById('mday-sheet').classList.remove('show');
  sheetKey = null;
  editingNote = null;
}

function paintSheet() {
  const k = sheetKey;
  const d = pd(k);
  const acc = DAYACC[dayIndex(d)];
  const sheet = document.getElementById('mday-sheet');
  sheet.style.borderTopColor = acc;

  const num = document.getElementById('msh-num');
  num.style.color = acc;
  num.textContent = d.getDate();
  document.getElementById('msh-dow').textContent = DW[dayIndex(d)].toUpperCase();
  document.getElementById('msh-full').textContent =
    MFULL[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' · week ' + isoWeek(d);

  const index = indexFor(d, d);
  const events = eventsOn(index, k).filter(e => e.type !== 'note');

  const evHTML = events.map(e => `
    <div class="msheet-evt">
      <div class="mse-bar" style="background:${e.colour}"></div>
      <div><div class="mse-nm">${esc(e.label)}</div><div class="mse-sub">${esc(e.sub)}</div></div>
    </div>`).join('');

  const notes = (state.notes || []).filter(n => n.on_date === k);
  const notesHTML = `<div class="msheet-notes">
    <div class="mnl">Notes</div>
    ${notes.map(n => editingNote === n.id ? `
      <div>
        <textarea class="mnote-area" id="mne-${n.id}" rows="2" style="border-bottom-color:${acc}">${esc(n.body)}</textarea>
        <div style="display:flex;gap:7px;margin-top:6px">
          <button class="mnote-save-btn" style="background:${acc}" data-savenote="${n.id}">Save</button>
          <button class="mnote-cancel-btn" data-cancelnote="1">Cancel</button>
        </div>
      </div>` : `
      <div class="mnote-item">
        <div class="mnt">${esc(n.body)}</div>
        <div class="mnote-acts">
          <button class="mnx" title="Edit" data-editnote="${n.id}">✎</button>
          <button class="mnx" title="Delete" data-delnote="${n.id}">×</button>
        </div>
      </div>`).join('')}
    <textarea class="mnote-area" id="mnote-new" rows="2" aria-label="Add a note"></textarea>
    <div><button class="mnote-add-btn" style="background:${acc}" id="mnote-add">Add note</button></div>
  </div>`;

  document.getElementById('msh-body').innerHTML =
    (evHTML || '<div class="msheet-empty">Nothing scheduled. Add a note below.</div>') + notesHTML;

  if (editingNote != null) {
    const ta = document.getElementById('mne-' + editingNote);
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  wireSheet(k);
}

function wireSheet(k) {
  const addBtn = document.getElementById('mnote-add');
  if (addBtn) addBtn.onclick = async () => {
    const box = document.getElementById('mnote-new');
    const body = box ? box.value.trim() : '';
    if (!body) { toast('Type something first'); return; }
    try {
      await addNote(k, body);
      await refetchAndRepaint();
      openSheet(k);
      toast('Noted');
    } catch (err) { toast("Couldn't save that: " + err.message); }
  };

  document.querySelectorAll('[data-editnote]').forEach(b => b.onclick = () => {
    editingNote = b.dataset.editnote;
    paintSheet();
  });
  document.querySelectorAll('[data-cancelnote]').forEach(b => b.onclick = () => {
    editingNote = null;
    paintSheet();
  });
  document.querySelectorAll('[data-savenote]').forEach(b => b.onclick = async () => {
    const field = document.getElementById('mne-' + b.dataset.savenote);
    const body = field ? field.value.trim() : '';
    if (!body) { toast('A note can’t be empty — delete it instead'); return; }
    try {
      await updateNote(b.dataset.savenote, body);
      editingNote = null;
      await refetchAndRepaint();
      openSheet(k);
      toast('Saved');
    } catch (err) { toast("Couldn't save that: " + err.message); }
  });
  document.querySelectorAll('[data-delnote]').forEach(b => b.onclick = async () => {
    try {
      await removeNote(b.dataset.delnote);
      editingNote = null;
      await refetchAndRepaint();
      openSheet(k);
      toast('Deleted');
    } catch (err) { toast("Couldn't delete that: " + err.message); }
  });
}

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
