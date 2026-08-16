/* Ledger — Round-up
 *
 * Run it after a categorizing session. It isn't scheduled, because
 * categorizing isn't — that is why the GitHub Action it replaces was rebuilt
 * from scheduled to manual-trigger in the first place.
 *
 * There is no running total and no transfer log here. A tracker that only ever
 * sees money going in drifts into fiction the first time you withdraw some.
 * "I moved the money" writes a date and nothing else; the amount lives in your
 * bank, not here.
 */

import { today, add, key, pd, fmtD, money } from '../dates.js';
import { callFunction, loadRoundupRuns, addRoundupRun } from '../data.js';
import { dateField, onDateChange, dateValue } from '../ui/datepicker.js';
import { toast } from '../ui/toast.js';
import { openHelp } from '../help.js';

const CATEGORIES = [
  ['restaurants', 'Restaurants'],
  ['food-delivery', 'Food delivery'],
  ['alcohol', 'Alcohol / bars'],
  ['rideshare', 'Rideshare'],
  ['transit', 'Transit'],
];

let host = null;
let onChanged = () => {};
let state = {
  /* Groceries, subscriptions and pay-later plans stay out on purpose. */
  chosen: new Set(CATEGORIES.map(c => c[0])),
  result: null,
  running: false,
  error: null,
  runs: [],
};

export function setChangeHandler(fn) { onChanged = fn; }

export async function mount(el) {
  host = el;
  try {
    state.runs = await loadRoundupRuns();
  } catch { /* the tab still works without the history */ }
  render();
}

function render() {
  const alreadyToday = state.runs.some(r => r.ran_on === key(today()));

  host.innerHTML = `
    <div class="helprow"><button class="qbtn" data-help="ru" aria-label="How this works">?</button></div>
    <div class="panel ru">
      <div class="ru-top">
        <div>
          <div class="label">Round-up total</div>
          <div class="amt mono"${state.result ? '' : ' style="color:var(--faint)"'}>${
            state.result ? `<i>+${state.result.total.toFixed(2)}</i>` : '—'}</div>
          <div class="sub">${subline()}</div>
        </div>
        <div class="ctl">
          <div class="label" style="margin-bottom:6px">Date range</div>
          <div class="dates">
            ${dateField('ruStart', { value: key(add(today(), -30)), label: 'Start date' })}
            <span>to</span>
            ${dateField('ruEnd', { value: key(today()), label: 'End date' })}
          </div>
          <div class="label" style="margin-bottom:6px">Categories</div>
          <div class="cats">${CATEGORIES.map(([k, label]) =>
            `<button data-cat="${k}" aria-pressed="${state.chosen.has(k)}">${label}</button>`).join('')}</div>
          <div class="rurow">
            <button class="go" id="ruRun"${state.running ? ' disabled' : ''}>${
              state.running ? 'Working…' : 'Recalculate'}</button>
            <button class="tbtn" id="ruLog"${alreadyToday ? ' disabled' : ''}>${
              alreadyToday ? 'Marked for today' : 'I moved the money'}</button>
          </div>
          ${state.error ? `<div class="warn" style="color:var(--alert)">${esc(state.error)}</div>` : ''}
        </div>
      </div>
    </div>
    ${state.result ? breakdownHTML(state.result) : ''}
    ${runsHTML()}`;

  wire();
}

function subline() {
  if (state.running) return 'Asking Lunch Money…';
  if (state.error) return 'Nothing calculated';
  if (!state.result) return 'Pick a range and recalculate';
  const r = state.result;
  if (!r.count) return 'No matching transactions in that range';
  return `${r.count} transaction${r.count === 1 ? '' : 's'} across ` +
         `${r.byCategory.length} categor${r.byCategory.length === 1 ? 'y' : 'ies'}`;
}

function breakdownHTML(r) {
  return `
    <div class="panel" style="margin-top:13px">
      <div class="label" style="margin-bottom:4px">Where it came from</div>
      <div class="brk">${r.byCategory.length
        ? r.byCategory.map(c => `<div class="bd">
            <div class="c">${esc(c.name)}</div>
            <div class="v mono">+${c.save.toFixed(2)}</div>
            <div class="n">${c.count} transaction${c.count === 1 ? '' : 's'}</div>
          </div>`).join('')
        : '<div class="bd"><div class="n">Nothing matched in this range</div></div>'}</div>
      ${r.uncategorized ? `<div class="warn" style="margin-top:14px">
        ${r.uncategorized} transaction${r.uncategorized === 1 ? '' : 's'} in this range
        ${r.uncategorized === 1 ? 'is' : 'are'} uncategorised and ${r.uncategorized === 1 ? 'was' : 'were'} skipped —
        categorise ${r.uncategorized === 1 ? 'it' : 'them'} in Lunch Money and run this again</div>` : ''}
      <div style="font-size:11.5px;color:var(--faint);margin-top:14px;line-height:1.7">
        ${money(r.spend)} of spending rounded up to the next dollar.
        Groceries, subscriptions and pay-later plans are excluded on purpose.
      </div>
    </div>`;
}

/* The tab's own memory. The calendar carries these as markers, but a marker
 * answers "did I?" and this answers "over what?". */
function runsHTML() {
  if (!state.runs.length) return '';
  return `<h2 class="sec">When you moved it</h2>
    <div class="panel" style="padding:3px 2px">
      ${state.runs.slice(0, 10).map(r => `<div class="lrow">
        <span class="when">${fmtD(pd(r.ran_on))}</span>
        <span class="card">Moved the round-up<span class="sub"> · ${
          r.range_start && r.range_end
            ? `swept ${fmtD(pd(r.range_start))} – ${fmtD(pd(r.range_end))}`
            : 'range not recorded'}</span></span>
      </div>`).join('')}
    </div>`;
}

const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function wire() {
  host.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
    const k = b.dataset.cat;
    state.chosen.has(k) ? state.chosen.delete(k) : state.chosen.add(k);
    /* Toggling recalculates only if there is already a result to update —
       otherwise it would call Lunch Money on every chip press. */
    if (state.result) run(); else render();
  });

  const runBtn = host.querySelector('#ruRun');
  if (runBtn) runBtn.onclick = run;

  const logBtn = host.querySelector('#ruLog');
  if (logBtn) logBtn.onclick = async () => {
    const k = key(today());
    if (state.runs.some(r => r.ran_on === k)) { toast('Already marked for today'); return; }
    try {
      /* The range is what the marker means months later — without it the
         calendar records that you moved money and nothing about which. */
      const swept = state.result
        ? [state.result.start, state.result.end]
        : [dateValue('ruStart'), dateValue('ruEnd')];
      const row = await addRoundupRun(k, swept[0], swept[1]);
      /* The date is already known, so it is set here rather than read back out
         of the response — the button's state should not depend on the shape of
         what the insert happened to return. */
      state.runs.unshift({ ...(row || {}), ran_on: k, range_start: swept[0], range_end: swept[1] });
      render();
      onChanged();
      toast('Marked on the calendar for ' + fmtD(today()));
    } catch (err) {
      toast(err.message.includes('duplicate')
        ? 'Already marked for today'
        : "Couldn't mark that: " + err.message);
    }
  };
}

async function run() {
  if (!state.chosen.size) { toast('Turn a category back on'); return; }

  const start = dateValue('ruStart') || key(add(today(), -30));
  const end = dateValue('ruEnd') || key(today());
  if (pd(start) > pd(end)) { toast('The start date is after the end date'); return; }

  state.running = true; state.error = null; render();
  try {
    state.result = await callFunction('calc-roundup', {
      start, end, categories: [...state.chosen],
    });
  } catch (err) {
    state.result = null;
    state.error = err.message;
  } finally {
    state.running = false;
    render();
  }
}
