/* Ledger mobile — Calendar (month view).
 *
 * Every day is tappable, out-of-month days included — there is nowhere on
 * the calendar you can't open and jot a note, same rule as desktop.
 */

import { today, add, mon, key, pd, isoWeek, MFULL, DW } from '../../../../assets/js/dates.js';
import { isPaydayOn } from '../../../../assets/js/bills.js';
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

  host.innerHTML = `
    <div class="mtopbar" style="padding-bottom:6px">
      <div class="mtitle">${MFULL[m]}</div>
      <div style="display:flex;gap:6px">
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
    </div>`;

  host.querySelector('#calPrev').onclick = () => { calMonth = new Date(y, m - 1, 1); render(); };
  host.querySelector('#calNext').onclick = () => { calMonth = new Date(y, m + 1, 1); render(); };
  host.querySelectorAll('[data-day]').forEach(c => c.onclick = () => openSheet(c.dataset.day));
}
