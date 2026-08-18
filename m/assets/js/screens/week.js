/* Ledger mobile — Week view (home).
 *
 * Payday and its "Move day" banner go through the same functions desktop
 * uses — bills.js's paydayFor()/isPaydayOn() and data.js's movePayday()/
 * clearPaydayOverride() — never a locally invented day-of-week map. An
 * override names a replacement date; which week it belongs to is derived
 * from that date, so moving payday in one week never touches the next.
 */

import { today, add, mon, key, pd, fmtD, fmtDW, money, MN, DW, isoWeek } from '../../../../assets/js/dates.js';

const DOWFULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
import { paydayFor, isPaydayOn } from '../../../../assets/js/bills.js';
import { eventsOn, eventsBetween } from '../../../../assets/js/events.js';
import { touchOccurrence, movePayday, clearPaydayOverride } from '../../../../assets/js/data.js';
import { state, indexFor } from '../state.js';
import { openSheet, refetchAndRepaint } from '../shell.js';
import { toast } from '../toast.js';

let host = null;
let weekStart = mon(today());

export async function mount(el) {
  host = el;
  render();
}

export function render() {
  if (!host) return;
  const days = Array.from({ length: 7 }, (_, i) => add(weekStart, i));
  const overrides = state.paydayOverrides || [];
  const payDate = paydayFor(weekStart, overrides);
  const isCurrentWeek = key(weekStart) === key(mon(today()));
  const index = indexFor(days[0], days[6]);
  const todayKey = key(today());

  const strip = days.map(d => {
    const k = key(d);
    const isT = k === todayKey;
    const isP = isPaydayOn(d, overrides);
    const ev = eventsOn(index, k);
    return `<div class="ds${isT ? ' tod' : ''}${isP ? ' payd' : ''}${ev.length ? ' has-e' : ''}">
      <div class="dow">${DW[(d.getDay() + 6) % 7]}</div><div class="dn">${d.getDate()}</div><div class="mark"></div></div>`;
  }).join('');

  const events = eventsBetween(index, days[0], days[6]);
  const rows = events.map(rowHTML).join('');

  host.innerHTML = `
    <div style="flex-shrink:0">
      <div class="mtopbar" style="padding-bottom:8px">
        <div>
          <div class="mtitle">Week ${isoWeek(weekStart)}</div>
          <div class="week-sub">${MN[days[0].getMonth()]} ${days[0].getDate()}–${days[0].getMonth() === days[6].getMonth() ? days[6].getDate() : MN[days[6].getMonth()] + ' ' + days[6].getDate()}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="marr" id="wkPrev">‹</button>
          <button class="marr" id="wkNow" style="width:auto;padding:0 10px;font-family:var(--mono);font-size:9px;letter-spacing:.08em">Now</button>
          <button class="marr" id="wkNext">›</button>
        </div>
      </div>
      <div class="day-strip">${strip}</div>
      <div class="mdivider"></div>
      <div class="pay-banner" style="display:flex">
        <div>
          <div style="margin-bottom:2px">💸 Payday · ${DOWFULL[(payDate.getDay() + 6) % 7]}</div>
          <div style="font-size:8px;opacity:.7;letter-spacing:.1em">${isCurrentWeek ? 'THIS WEEK' : 'WEEK OF ' + fmtD(weekStart).toUpperCase()}</div>
        </div>
        <button id="wkMoveDay" style="margin-left:auto;background:transparent;border:1px solid rgba(192,80,112,.4);color:var(--pay);font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:4px 9px;cursor:pointer;touch-action:manipulation">Move day</button>
      </div>
    </div>
    <div class="wk-body" style="display:flex;flex-direction:column;flex:1">
      <div id="wkRows" style="flex:1">${rows}</div>
      <div class="wk-summ">
        <div><div class="sk" id="wkPaid">$0.00</div><div class="sv">paid</div></div>
        <div style="text-align:right"><div class="sk" id="wkDue">$0.00</div><div class="sv">still due</div></div>
      </div>
    </div>`;

  wire(index, days);
  summarise();
}

function rowHTML(e) {
  const d = pd(e.date);
  const when = `<div style="width:36px;flex-shrink:0;text-align:center"><div class="mono" style="font-size:15px">${String(d.getDate()).padStart(2, '0')}</div>
    <div style="font-family:var(--mono);font-size:8px;color:var(--faint);text-transform:uppercase">${MN[d.getMonth()]}</div></div>`;

  if (e.type === 'bill') {
    const isLoan = e.isLoan;
    const balLine = isLoan && state.debt
      ? `<div class="bal">${money(state.debt.current_balance)} balance</div>` : '';
    return `<div class="wk-row" data-day="${e.date}" data-occ="${e.ref.bill.id}|${e.ref.occurrence.dateKey}" data-loan="${isLoan ? '1' : ''}">
      ${isLoan ? '<div class="wk-spacer"></div>'
        : `<button class="wk-tick${e.paid ? ' ck' : ''}" data-tick="1" aria-label="Toggle paid"></button>`}
      <div class="mbar" style="background:${e.colour}"></div>
      ${when}
      <div class="wrn"><div class="nm">${esc(e.label)}</div><div class="dt">${fmtDW(d)}</div>${balLine}</div>
      <div class="wrv${e.paid ? ' done' : isLoan ? ' lv' : ''}${e.amount == null ? ' est' : ''}">${e.amount == null ? '~' : money(e.amount)}</div>
    </div>`;
  }
  if (e.type === 'close') {
    return `<div class="wk-row" data-day="${e.date}"><div class="wk-spacer"></div><div class="mbar" style="background:${e.colour}"></div>${when}
      <div class="wrn"><div class="nm">${esc(e.label)}</div><div class="dt">${e.sub}</div></div>
      <span style="font-family:var(--mono);font-size:9px;border:1px solid rgba(232,176,75,.4);color:var(--warn);padding:3px 7px;letter-spacing:.1em;text-transform:uppercase">Closes</span></div>`;
  }
  if (e.type === 'pbk' || e.type === 'pbwant') {
    return `<div class="wk-row" data-day="${e.date}"><div class="wk-spacer"></div><div class="mbar" style="background:${e.colour}"></div>${when}
      <div class="wrn"><div class="nm">${esc(e.label)}</div><div class="dt">${e.sub}</div></div>
      <div class="wrv">${money(e.amount)}</div></div>`;
  }
  return '';
}

function wire(index, days) {
  /* The loan row has no special action on mobile — no tick, no tap — per the
   * spec's row table; the loan detail modal stays desktop-only. */
  host.querySelectorAll('.wk-row').forEach(row => {
    if (row.dataset.loan === '1') return;
    row.onclick = ev => {
      if (ev.target.closest('[data-tick]')) return;
      openSheet(row.dataset.day);
    };
  });

  host.querySelectorAll('[data-tick]').forEach(btn => btn.onclick = async ev => {
    ev.stopPropagation();
    const row = btn.closest('.wk-row');
    const [billId, dueDate] = row.dataset.occ.split('|');
    const nowDone = !btn.classList.contains('ck');
    btn.classList.toggle('ck');
    row.classList.toggle('done');
    summarise();
    try {
      await touchOccurrence(billId, dueDate, { paid_at: nowDone ? key(today()) : null });
      await refetchAndRepaint();
      toast(nowDone ? 'Marked paid' : 'Unmarked');
    } catch (err) {
      btn.classList.toggle('ck');
      toast("Couldn't save that: " + err.message);
    }
  });

  const prev = host.querySelector('#wkPrev'), next = host.querySelector('#wkNext'), now = host.querySelector('#wkNow');
  if (prev) prev.onclick = () => { weekStart = add(weekStart, -7); render(); };
  if (next) next.onclick = () => { weekStart = add(weekStart, 7); render(); };
  if (now) now.onclick = () => { weekStart = mon(today()); render(); };

  const moveBtn = host.querySelector('#wkMoveDay');
  if (moveBtn) moveBtn.onclick = () => cyclePayday();
}

/* Cycles the payday's day-of-week for this week only. Rolling back to
 * Thursday clears the override row rather than writing one that names the
 * default, so a week with no override and a week explicitly moved back to
 * Thursday cannot come apart from each other. */
async function cyclePayday() {
  const overrides = state.paydayOverrides || [];
  const weekKey = key(weekStart);
  const current = paydayFor(weekStart, overrides);
  const curDow = (current.getDay() + 6) % 7;      // 0 = Monday
  const nextDow = (curDow + 1) % 7;
  const nextDate = add(weekStart, nextDow);

  try {
    if (nextDow === 3) {
      const existing = overrides.find(o => key(mon(pd(o.on_date))) === weekKey);
      if (existing) await clearPaydayOverride(existing.id);
    } else {
      await movePayday(key(nextDate));
    }
    await refetchAndRepaint();
    toast('Payday → ' + DOWFULL[nextDow] + ' (this week only)');
  } catch (err) { toast("Couldn't change that: " + err.message); }
}

function summarise() {
  let due = 0, paid = 0;
  host.querySelectorAll('.wk-row[data-occ]').forEach(row => {
    const isLoan = row.dataset.loan === '1';
    const v = parseFloat(row.querySelector('.wrv')?.textContent.replace(/[^0-9.]/g, '')) || 0;
    const done = row.querySelector('.wk-tick')?.classList.contains('ck') || (isLoan && row.classList.contains('done'));
    done ? paid += v : due += v;
  });
  const a = host.querySelector('#wkDue'), b = host.querySelector('#wkPaid');
  if (a) a.textContent = money(due);
  if (b) b.textContent = money(paid);
}

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
