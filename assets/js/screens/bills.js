/* Ledger — Bills
 *
 * Entered by hand rather than synced. Lunch Money's recurring items model an
 * amount and a frequency; a bill here has a start, sometimes an end, and — for
 * anything on autopay — a reminder to get the funds in place before it fires.
 * None of that survives a round trip through a recurring item.
 *
 * Nothing is generated ahead. A bill's occurrences are derived every time the
 * calendar draws, so entering one today puts it on the calendar for 2031 and
 * changing its cadence corrects every future date at once.
 */

import { today, add, key, pd, fmtD, money, MFULL } from '../dates.js';
import { CADENCES, cadenceLabel, occurrences } from '../bills.js';
import { loadBills, saveBill, archiveBill } from '../data.js';
import { dateField, dateValue, setDate } from '../ui/datepicker.js';
import { selectField, selectValue, onSelectChange } from '../ui/select.js';
import { toast } from '../ui/toast.js';

let host = null;
let data = { bills: [], billInstances: [] };
let editing = null;          // null = form closed; {} = new; a bill = editing it
let onChanged = () => {};

export function setChangeHandler(fn) { onChanged = fn; }

export async function mount(el) {
  host = el;
  try {
    data = await loadBills();
    render();
  } catch (err) {
    host.innerHTML = `<div class="soon"><div class="t">Couldn't load your bills</div>
      <div class="b">${esc(err.message)}</div></div>`;
  }
}

export async function reload() {
  data = await loadBills();
  render();
}

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function render() {
  const bills = data.bills.filter(b => b.active !== false);
  const monthly = bills.reduce((n, b) => n + monthlyEquivalent(b), 0);

  host.innerHTML = `
    <div class="grid g3" style="margin-bottom:14px">
      <div class="panel stat"><div class="k mono">${bills.length}</div><div class="v">Bills tracked</div></div>
      <div class="panel stat"><div class="k mono">${money(monthly)}</div>
        <div class="v">Roughly per month, all cadences levelled</div></div>
      <div class="panel stat"><div class="k mono">${bills.filter(b => b.reminder_days_before).length}</div>
        <div class="v">With a funding reminder</div></div>
    </div>

    ${editing ? formHTML() : `<div class="ff" style="margin-bottom:18px">
      <button class="go" id="newBill">Add a bill</button>
    </div>`}

    ${bills.length ? bills.slice().sort(byNextDue).map(rowHTML).join('')
      : `<div class="panel lempty">
          No bills yet.<br>Add one and every future occurrence appears on the calendar —
          nothing is generated ahead, so a bill starting in December simply shows up in December.
        </div>`}`;

  wire();
}

/* Levelled so cadences are comparable at a glance. Not money that leaves in any
 * given month — a yearly bill does not take a twelfth of itself each month —
 * which is why the label says "roughly". */
function monthlyEquivalent(b) {
  const a = Number(b.amount) || 0;
  switch (b.cadence) {
    case 'weekly':    return a * 52 / 12;
    case 'biweekly':  return a * 26 / 12;
    case 'quarterly': return a / 3;
    case 'yearly':    return a / 12;
    case 'once':      return 0;
    default:          return a;
  }
}

const nextDueOf = b => occurrences(b, today(), add(today(), 400))[0] || null;
const byNextDue = (a, b) => {
  const x = nextDueOf(a), y = nextDueOf(b);
  if (!x && !y) return a.name.localeCompare(b.name);
  if (!x) return 1;
  if (!y) return -1;
  return x - y;
};

function rowHTML(b) {
  const next = nextDueOf(b);
  const ended = b.ends_on && pd(b.ends_on) < today();
  const future = pd(b.starts_on) > today();

  return `<div class="billrow${ended ? ' ended' : ''}">
    <div class="bn">
      <div class="n">${esc(b.name)}</div>
      <div class="t">${cadenceLabel(b.cadence)}${b.category ? ' · ' + esc(b.category) : ''}${
        b.is_auto ? ' · autopay' : ''}</div>
      ${b.reminder_days_before ? `<div class="t rem">↳ ${b.reminder_days_before} day${
        b.reminder_days_before === 1 ? '' : 's'} before: ${esc(b.reminder_text || 'check the funds are there')}</div>` : ''}
    </div>
    <div class="bw">
      ${ended ? '<span class="chip est">Ended</span>'
        : future ? `<span class="chip est">Starts ${fmtD(pd(b.starts_on))}</span>`
        : next ? `<span class="cs">next ${fmtD(next)}</span>` : '<span class="cs">no more due</span>'}
      ${b.ends_on && !ended ? `<div class="cs">until ${fmtD(pd(b.ends_on))}</div>` : ''}
    </div>
    <div class="ba mono">${money(b.amount)}</div>
    <div class="bx">
      <button class="tbtn" data-edit="${b.id}">Edit</button>
      <button class="tbtn" data-archive="${b.id}">Remove</button>
    </div>
  </div>`;
}

function formHTML() {
  const b = editing.id ? editing : {
    name: '', amount: '', cadence: 'monthly', starts_on: key(today()),
    ends_on: null, is_auto: false, reminder_days_before: '', reminder_text: '', category: '',
  };

  return `<div class="pbform">
    <div class="label" style="margin-bottom:15px">${b.id ? 'Edit this bill' : 'Add a bill'}</div>

    <div class="ff">
      <div class="fld grow"><span class="label">What is it?</span>
        <input id="bName" type="text" autocomplete="off" value="${esc(b.name)}"></div>
      <div class="fld"><span class="label">How much?</span>
        <div class="amtin"><span>$</span><input id="bAmt" type="number" min="0" step="0.01"
          placeholder="0" value="${b.amount === '' ? '' : Number(b.amount).toFixed(2)}"></div></div>
    </div>

    <div class="ff">
      <div class="fld grow"><span class="label">How often?</span>
        ${selectField('bCad', CADENCES, b.cadence, 'How often this repeats')}</div>
      <div class="fld"><span class="label">First one on</span>
        ${dateField('bStart', { value: b.starts_on, label: 'Start date' })}</div>
      <div class="fld"><span class="label">Ends</span>
        ${dateField('bEnd', { value: b.ends_on || key(add(today(), 365)), label: 'End date' })}
        <label class="capcheck" style="margin-top:8px"><input type="checkbox" id="bNoEnd"
          ${b.ends_on ? '' : 'checked'}><span>No end date / unknown</span></label></div>
    </div>

    <div class="ff">
      <label class="capcheck"><input type="checkbox" id="bAuto" ${b.is_auto ? 'checked' : ''}>
        <span>This one is on autopay</span></label>
    </div>

    <div class="fnote">
      A reminder appears on the calendar a few days ahead and can be ticked off like a bill.
      It belongs to the bill, so it stops when the bill does.
    </div>

    <div class="ff">
      <div class="fld"><span class="label">Remind me this many days before</span>
        <div class="amtin"><input id="bRemDays" type="number" min="0" max="30" step="1"
          placeholder="none" value="${b.reminder_days_before || ''}" style="width:70px"></div></div>
      <div class="fld grow"><span class="label">Reminder wording</span>
        <input id="bRemText" type="text" autocomplete="off"
          placeholder="Make sure the funds are in the right account"
          value="${esc(b.reminder_text || '')}"></div>
    </div>

    <div class="ff">
      <button class="go" id="bSave">${b.id ? 'Save changes' : 'Add it'}</button>
      <button class="tbtn" id="bCancel">Cancel</button>
    </div>
  </div>`;
}

function wire() {
  const nb = host.querySelector('#newBill');
  if (nb) nb.onclick = () => { editing = {}; render(); host.querySelector('#bName').focus(); };

  const cancel = host.querySelector('#bCancel');
  if (cancel) cancel.onclick = () => { editing = null; render(); };

  host.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    editing = data.bills.find(x => x.id === b.dataset.edit);
    render();
  });

  host.querySelectorAll('[data-archive]').forEach(b => b.onclick = async () => {
    const bill = data.bills.find(x => x.id === b.dataset.archive);
    try {
      /* Deactivated, not deleted — anything already ticked keeps its meaning. */
      await archiveBill(bill.id);
      await reload();
      onChanged();
      toast(`Removed ${bill.name}`);
    } catch (err) { toast("Couldn't remove that: " + err.message); }
  });

  const save = host.querySelector('#bSave');
  if (save) save.onclick = async () => {
    const name = host.querySelector('#bName').value.trim();
    const amount = parseFloat(host.querySelector('#bAmt').value);
    if (!name) { toast('Give it a name'); return; }
    if (!isFinite(amount) || amount < 0) { toast('Enter the amount'); return; }

    const noEnd = host.querySelector('#bNoEnd').checked;
    const remDays = parseInt(host.querySelector('#bRemDays').value, 10);
    const starts = dateValue('bStart') || key(today());
    const ends = noEnd ? null : (dateValue('bEnd') || null);

    if (ends && pd(ends) < pd(starts)) { toast('The end date is before the start'); return; }

    save.disabled = true;
    try {
      await saveBill({
        id: editing.id,
        name, amount,
        cadence: selectValue('bCad') || 'monthly',
        starts_on: starts,
        ends_on: ends,
        is_auto: host.querySelector('#bAuto').checked,
        reminder_days_before: isFinite(remDays) && remDays >= 0 ? remDays : null,
        reminder_text: host.querySelector('#bRemText').value.trim() || null,
        category: editing.category || null,
      });
      editing = null;
      await reload();
      onChanged();
      toast(`Saved ${name}`);
    } catch (err) {
      save.disabled = false;
      toast("Couldn't save that: " + err.message);
    }
  };
}
