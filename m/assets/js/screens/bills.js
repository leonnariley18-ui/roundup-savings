/* Ledger mobile — Bills (read-only list; tick in the week view instead). */

import { today, add, key, pd, fmtD, money, MN } from '../../../../assets/js/dates.js';
import { CADENCES, cadenceLabel, occurrences } from '../../../../assets/js/bills.js';
import { state } from '../state.js';

let host = null;
let billYear = today().getFullYear();
let billMonth = today().getMonth();

export async function mount(el) {
  host = el;
  render();
}

export function render() {
  if (!host) return;
  const isCurrent = billYear === today().getFullYear() && billMonth === today().getMonth();
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
    const inst = (state.billInstances || []).find(i => i.bill_id === r.bill.id && i.due_date === key(r.due));
    if (!(inst && inst.paid_at)) dueLeft += amt;
  });

  const upcoming = isCurrent ? rows.filter(r => r.due > today()) : rows;
  const earlier = isCurrent ? rows.filter(r => r.due <= today()) : [];
  upcoming.sort((a, b) => a.due - b.due);
  earlier.sort((a, b) => a.due - b.due);

  host.innerHTML = `
    <div class="mtopbar" style="flex-shrink:0;padding-bottom:8px">
      <div class="mtitle">Bills</div>
      <div style="display:flex;align-items:center;gap:6px;padding-bottom:4px">
        <button class="marr" id="billPrev">‹</button>
        <span style="font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;min-width:72px;text-align:center">${MN[billMonth]} ${billYear}</span>
        <button class="marr" id="billNext">›</button>
      </div>
    </div>
    <div style="padding:8px 20px 0;font-family:var(--sans);font-size:12px;color:var(--faint);flex-shrink:0">Tick bills off in the week view.</div>
    <div class="bill-summ">
      <div class="bill-amt">${money(Math.max(0, dueLeft))}</div>
      <div class="bill-sub">still due this month</div>
      <div class="bprog"><i style="width:${total ? Math.round((total - dueLeft) / total * 100) : 0}%"></i></div>
    </div>
    <div class="mdivider"></div>
    <div style="flex:1;overflow-y:auto">
      ${upcoming.length ? `<div class="bsect-lbl">Upcoming</div>${upcoming.map(rowHTML).join('')}` : ''}
      ${earlier.length ? `<div class="bsect-lbl" style="margin-top:6px">Earlier</div>${earlier.map(rowHTML).join('')}` : ''}
      ${!rows.length ? '<div class="msoon"><div class="t">Nothing this month</div></div>' : ''}
    </div>`;

  host.querySelector('#billPrev').onclick = () => { billMonth--; if (billMonth < 0) { billMonth = 11; billYear--; } render(); };
  host.querySelector('#billNext').onclick = () => { billMonth++; if (billMonth > 11) { billMonth = 0; billYear++; } render(); };
}

function rowHTML(r) {
  const b = r.bill;
  const inst = (state.billInstances || []).find(i => i.bill_id === b.id && i.due_date === key(r.due));
  const paid = !!(inst && inst.paid_at);
  const isLoan = !!b.links_to_debt_id;
  const isAuto = !!b.is_auto && !paid;

  return `<div class="bill-row${isLoan ? ' ln-row' : ''}">
    <div style="width:3px;height:36px;flex-shrink:0;background:${isLoan ? 'var(--loan)' : paid ? 'var(--accent)' : isAuto ? 'var(--accent-2)' : 'var(--soft)'}"></div>
    <div class="binfo">
      <div class="nm">${esc(b.name)}</div>
      <div class="bsub">${b.is_auto ? 'autopay · ' : ''}${cadenceLabel(b.cadence).toLowerCase()} · due ${fmtD(r.due)}</div>
    </div>
    <div class="bamt${b.amount == null ? ' est' : ''}">${b.amount == null ? '~' : money(b.amount)}</div>
  </div>`;
}

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
