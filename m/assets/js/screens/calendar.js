/* Ledger mobile — Calendar (month view) + this month's bills, read-only.
 *
 * Every day is tappable, out-of-month days included — there is nowhere on
 * the calendar you can't open and jot a note, same rule as desktop.
 *
 * The bill list rides along below the grid rather than living on its own tab
 * — it's read-only (tick in the week view instead) and shares the same
 * month nav as the grid above it, so there's one "which month am I looking
 * at" instead of two.
 */

import { today, add, mon, key, pd, isoWeek, fmtD, money, MFULL, DW } from '../../../../assets/js/dates.js';
import { isPaydayOn, cadenceLabel, occurrences } from '../../../../assets/js/bills.js';
import { eventsOn } from '../../../../assets/js/events.js';
import { state, indexFor } from '../state.js';
import { openSheet } from '../shell.js';

let host = null;
let calMonth = new Date(today().getFullYear(), today().getMonth(), 1);

export async function mount(el) {
  host = el;
  render();
}

export function render() {
  if (!host) return;
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
    rows += `<div class="wnn${key(weekStart) === currentWeek ? ' cur' : ''}">${isoWeek(weekStart)}</div>`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(cur), k = key(d);
      const out = d.getMonth() !== m;
      const isT = k === todayKey;
      const events = eventsOn(index, k);
      const pips = events.map(e => `<span style="background:${e.colour}"></span>`).join('');
      const cls = ['cd'];
      if (out) cls.push('out');
      if (isT) cls.push('today-c');
      if (isPaydayOn(d, state.paydayOverrides || []) && !out) cls.push('pay-c');
      rows += `<div class="${cls.join(' ')}" data-day="${k}">
        <div class="cdn">${d.getDate()}</div>
        ${pips ? `<div class="mpips">${pips}</div>` : ''}
      </div>`;
      cur = add(cur, 1);
    }
  }

  const isCurrentMonth = y === today().getFullYear() && m === today().getMonth();

  host.innerHTML = `
    <div class="mtopbar" style="padding-bottom:6px">
      <div class="mtitle">${MFULL[m]}</div>
      <div style="display:flex;gap:6px">
        <button class="marr" id="calToday" style="width:auto;padding:0 10px;font-family:var(--mono);font-size:9px;letter-spacing:.08em"${isCurrentMonth ? ' disabled' : ''}>Today</button>
        <button class="marr" id="calPrev">‹</button>
        <button class="marr" id="calNext">›</button>
      </div>
    </div>
    <div class="mdivider"></div>
    <div class="cgrid">
      <div></div>${DW.map(d => `<div class="dowh">${d}</div>`).join('')}
      ${rows}
    </div>
    <div class="cal-legend">
      <div class="mle"><span style="background:var(--accent)"></span>Bill</div>
      <div class="mle"><span style="background:var(--warn)"></span>Closes</div>
      <div class="mle"><span style="background:var(--alert)"></span>Payback</div>
      <div class="mle"><span style="background:var(--pbk)"></span>Your target</div>
      <div class="mle"><span style="background:var(--save)"></span>Round-up</div>
      <div class="mle"><span style="background:var(--muted)"></span>Note</div>
    </div>
    ${billsSectionHTML(y, m, isCurrentMonth)}`;

  host.querySelector('#calToday').onclick = () => { calMonth = new Date(today().getFullYear(), today().getMonth(), 1); render(); };
  host.querySelector('#calPrev').onclick = () => { calMonth = new Date(y, m - 1, 1); render(); };
  host.querySelector('#calNext').onclick = () => { calMonth = new Date(y, m + 1, 1); render(); };
  host.querySelectorAll('[data-day]').forEach(c => c.onclick = () => openSheet(c.dataset.day));
}

/* Read-only — tick in the week view instead. Same month as the grid above,
 * so there's a single month-nav rather than a duplicate one. */
function billsSectionHTML(billYear, billMonth, isCurrent) {
  const monthStart = new Date(billYear, billMonth, 1);
  const monthEnd = new Date(billYear, billMonth + 1, 0);

  const rows = (state.bills || []).filter(b => b.active !== false).map(b => {
    const occ = occurrences(b, monthStart, monthEnd);
    if (!occ.length) return null;
    return { bill: b, due: occ[0] };
  }).filter(Boolean);

  let total = 0, dueLeft = 0;
  rows.forEach(r => {
    const amt = Number(r.bill.amount) || 0;
    total += amt;
    if (!isPaid(r)) dueLeft += amt;
  });

  const upcoming = isCurrent ? rows.filter(r => r.due > today()) : rows;
  const earlier = isCurrent ? rows.filter(r => r.due <= today()) : [];
  upcoming.sort((a, b) => a.due - b.due);
  earlier.sort((a, b) => a.due - b.due);

  return `
    <div class="bsect-lbl" style="border-top:2px solid var(--soft);padding-top:14px;margin-top:4px">Bills this month</div>
    <div style="padding:0 20px 8px;font-family:var(--sans);font-size:12px;color:var(--faint)">Tick bills off in the week view.</div>
    <div class="bill-summ" style="border-bottom:0">
      <div class="bill-amt">${money(Math.max(0, dueLeft))}</div>
      <div class="bill-sub">still due this month</div>
      <div class="bprog"><i style="width:${total ? Math.round((total - dueLeft) / total * 100) : 0}%"></i></div>
    </div>
    ${upcoming.length ? `<div class="bsect-lbl">Upcoming</div>${upcoming.map(billRowHTML).join('')}` : ''}
    ${earlier.length ? `<div class="bsect-lbl" style="margin-top:6px">Earlier</div>${earlier.map(billRowHTML).join('')}` : ''}
    ${!rows.length ? '<div class="msoon"><div class="t">Nothing this month</div></div>' : ''}`;
}

const isPaid = r => {
  const inst = (state.billInstances || []).find(i => i.bill_id === r.bill.id && i.due_date === key(r.due));
  return !!(inst && inst.paid_at);
};

function billRowHTML(r) {
  const b = r.bill;
  const paid = isPaid(r);
  const isLoan = !!b.links_to_debt_id;
  const isAuto = !!b.is_auto && !paid;

  return `<div class="bill-row${isLoan ? ' ln-row' : ''}">
    <div style="width:3px;height:36px;flex-shrink:0;background:${isLoan ? 'var(--loan)' : paid ? 'var(--accent)' : isAuto ? 'var(--accent-2)' : 'var(--soft)'}"></div>
    <div class="binfo">
      <div class="nm">${esc(b.name)}</div>
      <div class="bsub">${b.is_auto ? 'autopay · ' : ''}${cadenceLabel(b.cadence).toLowerCase()} · ${paid ? 'paid ' + fmtD(r.due) : 'due ' + fmtD(r.due)}${paid ? ' ✓' : ''}</div>
    </div>
    <div class="bamt${paid ? ' paid' : ''}${b.amount == null ? ' est' : ''}">${b.amount == null ? '~' : money(b.amount)}</div>
  </div>`;
}

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
