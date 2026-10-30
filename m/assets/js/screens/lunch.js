/* Ledger mobile — Lunch: a $40/day budget with rollover
 *
 * Same engine as desktop (assets/js/lunch.js, data.js) — only the markup is
 * mobile's own. Everything works here except editing the daily limit and
 * seeing the Activity log, which stay desktop-only; Zero out rollover lives
 * right on the main screen instead of behind a Settings panel, since there
 * isn't one here at all.
 */

import { today, add, mon, key, pd, fmtD, money } from '../../../../assets/js/dates.js';
import {
  loadLunch, logLunchPurchase, removeLunchPurchase, endLunchDay, reopenLunchDay,
  pauseLunchDays, resumeLunchDay, setLunchTrackingPaused, zeroLunchRollover,
  advanceLunchWeek, logLunchActivity,
} from '../../../../assets/js/data.js';
import {
  DOWS, daySpent, computeRollover, priorUnresolved, isPausable, weekFullyResolved,
  weekDaysWithVirtuals, groupIntoWeeks, gapWeeksBetween, weekdaysOf,
} from '../../../../assets/js/lunch.js';
import { toast } from '../toast.js';

const UBER_PRESETS = [18, 19, 20, 21, 22];

let host = null;
let lunchState = null;
let expandedWeeks = new Set();

export async function mount(el) {
  host = el;
  host.innerHTML = '<div class="msoon"><div class="t">Loading…</div></div>';
  try {
    lunchState = await loadLunch();
    await maybeAdvanceWeek();
    render();
  } catch (err) {
    host.innerHTML = `<div class="msoon"><div class="t">Couldn't load Lunch</div><div class="b">${err.message}</div></div>`;
  }
}

async function reload() {
  lunchState = await loadLunch();
  await maybeAdvanceWeek();
}

/* Same check as desktop — fresh on every load, no timer. See the comment on
 * the desktop screen for the full reasoning. */
async function maybeAdvanceWeek() {
  const t = today();
  let { settings, days } = lunchState;
  let openWeekStart = pd(settings.open_week_start);
  let guard = 0;

  while (guard++ < 2) {
    const weekRealDays = days.filter(d => weekdaysOf(openWeekStart).map(key).includes(d.on_date));
    const fri = add(openWeekStart, 4);
    if (!weekFullyResolved(openWeekStart, weekRealDays) || t <= fri) return;

    const weekDays = weekDaysWithVirtuals(openWeekStart, weekRealDays, settings.daily_limit);
    const newRolloverBase = computeRollover(settings, weekDays, lunchState.purchasesByDate, t);
    const nextMonday = mon(t);

    const patch = { rollover_base: newRolloverBase, rollover_base_date: key(fri), open_week_start: key(nextMonday) };
    if (settings.scheduled_limit != null && settings.scheduled_limit_monday === key(nextMonday)) {
      patch.daily_limit = settings.scheduled_limit;
      patch.scheduled_limit = null;
      patch.scheduled_limit_monday = null;
      await logLunchActivity(`Daily limit changed to ${money(settings.scheduled_limit)} (as scheduled)`);
    }
    await advanceLunchWeek(settings.user_id, patch);
    lunchState = await loadLunch();
    settings = lunchState.settings;
    days = lunchState.days;
    openWeekStart = pd(settings.open_week_start);
  }
}

export function render() {
  if (!host || !lunchState) return;
  const { settings, days, purchasesByDate } = lunchState;
  const t = today();
  const openWeekStart = pd(settings.open_week_start);
  const weekRealDays = days.filter(d => weekdaysOf(openWeekStart).map(key).includes(d.on_date));
  const weekDays = weekDaysWithVirtuals(openWeekStart, weekRealDays, settings.daily_limit);

  const fri = add(openWeekStart, 4);
  const isWeekend = t > fri;
  const todayKey = isWeekend ? key(fri) : key(t);
  const todayDay = weekDays.find(d => d.on_date === todayKey);
  const todayIdx = weekDays.findIndex(d => d.on_date === todayKey);

  const closedDays = days.filter(d => !weekdaysOf(openWeekStart).map(key).includes(d.on_date));
  const closedWeeks = groupIntoWeeks(closedDays, purchasesByDate);

  host.innerHTML = `
    <div class="mtopbar"><div class="mtitle">\u{1F96A} Lunch</div></div>
    <div class="mdivider"></div>
    <div id="lmToday"></div>
    <div class="bsect-lbl">Rest of this week <span class="mpausependingbadge" id="lmPausePending" hidden></span></div>
    <div id="lmDays"></div>
    <div class="lmzerofield" id="lmZeroField"></div>
    <div class="bsect-lbl">Closed weeks</div>
    <div id="lmClosedWeeks"></div>`;

  renderToday(todayDay, todayIdx, weekDays, openWeekStart, isWeekend);
  renderDays(weekDays, todayIdx, isWeekend);
  renderClosedWeeks(closedWeeks);
  renderZeroField();

  const badge = document.getElementById('lmPausePending');
  badge.hidden = !settings.tracking_paused;
  if (settings.tracking_paused) {
    badge.textContent = isWeekend ? '⏸ carries into next week' : '⏸ carries to each day';
  }
}

function renderToday(day, idx, weekDays, openWeekStart, isWeekend) {
  const { settings, purchasesByDate } = lunchState;
  const t = today();
  const purchases = purchasesByDate[day.on_date] || [];
  const spent = daySpent(purchases);
  const over = spent > day.daily_limit;
  const paused = settings.tracking_paused;
  const rollover = computeRollover(settings, lunchState.days, purchasesByDate, t);
  const deficit = rollover < 0;
  const dn = DOWS[idx], dd = fmtD(pd(day.on_date));

  const blockers = paused ? [] : priorUnresolved(weekDays, t);
  const blocked = blockers.length > 0;
  const locked = !!day.ended_at;

  const bankHTML = paused
    ? `<div class="lmamt">⏸ Paused</div><div class="lmsub">not tracking right now</div>`
    : `<div class="lmamt ${deficit ? 'deficit' : ''}">${deficit ? '' : '+'}${money(rollover)}</div><div class="lmsub">${deficit ? 'in the hole' : 'banked'}</div>`;

  const bodyHTML = paused
    ? `<div class="lmstatus paused">Not tracked while paused</div>${chipsHTML(purchases, true)}`
    : `<div class="lmspent"><span class="v mono">${money(spent)}</span><span class="lmtarget">${money(day.daily_limit)} target</span></div>
       <div class="lmstatus ${over ? 'over' : 'under'}">
         ${over ? '⚠ ' + money(spent - day.daily_limit) + ' over' : money(day.daily_limit - spent) + ' under'}
         ${day.ended_at ? ' ✓ ended' : ''}
       </div>`;

  const pausableBlockers = blockers.filter(d => isPausable(d, purchasesByDate));
  const blockHTML = !blocked ? '' : `
    <div class="lmblockbanner"><b>${blockers.map((d, i) => DOWS[weekDays.findIndex(w => w.on_date === d.on_date)] + ' ' + fmtD(pd(d.on_date))).join(', ')}
      ${blockers.length > 1 ? ' aren’t' : ' isn’t'} finished yet.</b> Before logging anything new today —
      <div class="lmgorow">
        ${blockers.map(d => `<button class="lmgobtn" data-endday="${d.on_date}">End ${DOWS[weekDays.findIndex(w => w.on_date === d.on_date)]}</button>`).join('')}
        ${pausableBlockers.length ? `<button class="lmgobtn pause" data-pausedays="${pausableBlockers.map(d => d.on_date).join(',')}">Pause ${pausableBlockers.map(d => DOWS[weekDays.findIndex(w => w.on_date === d.on_date)]).join(', ')} instead</button>` : ''}
      </div></div>`;

  const weekendNote = (!isWeekend || weekFullyResolved(openWeekStart, weekDays)) ? '' : `
    <div class="lmblockbanner"><b>Weekend — ${dn} ${dd} is still open.</b> No rush, but it needs wrapping up before Monday.
      ${isPausable(day, purchasesByDate) ? `<div class="lmgorow"><button class="lmgobtn pause" data-pausedays="${day.on_date}">Pause ${dn} instead</button></div>` : ''}</div>`;

  const weekDoneNote = (!isWeekend || !weekFullyResolved(openWeekStart, weekDays)) ? '' :
    `<div class="lmhint">All set for the week. Nothing to do until Monday.</div>`;

  const actionArea = paused ? '' : blocked ? blockHTML :
    chipsHTML(purchases, locked) + quickAddHTML(day.on_date, locked) + endBtnHTML(day) + reopenBtnHTML(day);

  const pauseBtn = (!paused && spent > 0)
    ? `<span class="lmpausebtn disabled">⏸ Pause tracking</span>`
    : `<button class="lmpausebtn" id="lmPauseBtn">${paused ? '▶ Resume tracking' : '⏸ Pause tracking'}</button>`;

  document.getElementById('lmToday').innerHTML = `
    <div class="pb-card lmtodaycard ${paused ? 'paused' : deficit ? 'urgent' : ''}">
      <div class="pc-top" style="flex-direction:column;align-items:stretch;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div><div class="lmlabel">${isWeekend ? dn + '’s record' : 'Today'} · ${dn} ${dd}</div>${bodyHTML}</div>
          <div style="text-align:right">${bankHTML}${pauseBtn}</div>
        </div>
      </div>
      <div class="pc-action" style="flex-direction:column;align-items:stretch">${actionArea}${weekendNote}${weekDoneNote}</div>
    </div>`;

  wireDayActions(document.getElementById('lmToday'));

  const pauseBtnEl = document.getElementById('lmPauseBtn');
  if (pauseBtnEl) pauseBtnEl.onclick = async () => {
    const next = !paused;
    try {
      await setLunchTrackingPaused(settings.user_id, next);
      await logLunchActivity(next ? 'Tracking paused — fell off, not counting days until resumed' : 'Tracking resumed');
      if (next) await pauseLunchDays([day.on_date], settings.daily_limit);
      else await resumeLunchDay(day.on_date);
      await reload(); render();
      toast(next ? 'Paused — not logging until you resume' : 'Resumed — back to tracking');
    } catch (err) { toast("Couldn't update that: " + err.message); }
  };
}

function renderDays(weekDays, todayIdx, isWeekend) {
  const { purchasesByDate } = lunchState;
  const html = weekDays.map((day, i) => {
    if (i === todayIdx) return `<div class="lmtodaymark">${DOWS[i]} ${fmtD(pd(day.on_date))} ${isWeekend ? '— shown above' : '— today, shown above'}</div>`;
    const purchases = purchasesByDate[day.on_date] || [];
    const spent = daySpent(purchases);
    const isFuture = pd(day.on_date) > today();
    const locked = day.paused || !!day.ended_at || isFuture;
    let statusText;
    if (day.paused) statusText = '⏸ paused';
    else if (purchases.length || !isFuture) {
      const over = spent > day.daily_limit;
      statusText = (over ? '⚠ ' + money(spent - day.daily_limit) + ' over' : money(day.daily_limit - spent) + ' under') + (day.ended_at ? ' ✓' : '');
    } else statusText = '—';

    return `<div class="bill-row lmday${locked ? ' lmlocked' : ''}">
      <div style="width:3px;align-self:stretch;flex-shrink:0;background:${day.paused ? 'var(--faint)' : day.ended_at ? 'var(--save)' : 'var(--soft)'}"></div>
      <div class="binfo">
        <div class="nm">${DOWS[i]} ${fmtD(pd(day.on_date))}</div>
        <div class="bsub">${money(day.daily_limit)} target · ${statusText}</div>
        ${chipsHTML(purchases, locked)}${quickAddHTML(day.on_date, locked)}${endBtnHTML(day)}
      </div>
      <div class="bamt">${day.paused ? '—' : money(spent)}</div>
    </div>`;
  }).join('');
  const el = document.getElementById('lmDays');
  el.innerHTML = html || '<div class="msoon"><div class="t">Nothing this week</div></div>';
  wireDayActions(el);
}

function chipsHTML(purchases, locked) {
  if (!purchases.length) return '';
  return `<div class="lmchips">${purchases.map(p => `<span class="lmchip"><b>${esc(p.label)}</b> ${money(p.amount)}${locked ? '' : ` <button data-removepurchase="${p.id}">×</button>`}</span>`).join('')}</div>`;
}

function quickAddHTML(onDate, locked) {
  if (locked) return '';
  return `<div class="lmquickrow">
    <button class="lmqbtn" data-dunkin="${onDate}">☕ Dunkin $5</button>
    <button class="lmqbtn" data-ubereats="${onDate}">\u{1F354} Uber Eats</button>
    <button class="lmqbtn" data-other="${onDate}">+ Other</button>
  </div><div class="lminline-add" id="ladd-${onDate}" hidden></div>`;
}

function endBtnHTML(day) {
  if (day.ended_at || day.paused || pd(day.on_date) > today()) return '';
  return `<button class="lmendbtn" data-endday="${day.on_date}">End day</button>`;
}

function reopenBtnHTML(day) {
  if (!day.ended_at) return '';
  return `<button class="lmendbtn" data-reopenday="${day.on_date}">Reopen day</button>`;
}

function wireDayActions(root) {
  const { settings } = lunchState;

  root.querySelectorAll('[data-removepurchase]').forEach(btn => btn.onclick = async () => {
    try { await removeLunchPurchase(btn.dataset.removepurchase); await reload(); render(); toast('Removed'); }
    catch (err) { toast("Couldn't remove that: " + err.message); }
  });
  root.querySelectorAll('[data-dunkin]').forEach(btn => btn.onclick = async () => {
    try {
      await logLunchPurchase({ onDate: btn.dataset.dunkin, label: 'Dunkin', amount: 5, source: 'dunkin', dailyLimit: settings.daily_limit });
      await reload(); render(); toast('Logged — $5 Dunkin');
    } catch (err) { toast("Couldn't log that: " + err.message); }
  });
  root.querySelectorAll('[data-other]').forEach(btn => btn.onclick = () => openInlineAdd(btn.dataset.other, true));
  root.querySelectorAll('[data-ubereats]').forEach(btn => btn.onclick = () => openUberPresets(btn.dataset.ubereats));
  root.querySelectorAll('[data-endday]').forEach(btn => btn.onclick = async () => {
    try {
      await endLunchDay(btn.dataset.endday, settings.daily_limit);
      await reload(); render();
      toast(`${btn.dataset.endday} ended — locked in. Reopen it if you need to.`);
    } catch (err) { toast("Couldn't end that: " + err.message); }
  });
  root.querySelectorAll('[data-reopenday]').forEach(btn => btn.onclick = async () => {
    try { await reopenLunchDay(btn.dataset.reopenday); await reload(); render(); toast('Reopened — back to logging'); }
    catch (err) { toast("Couldn't reopen that: " + err.message); }
  });
  root.querySelectorAll('[data-pausedays]').forEach(btn => btn.onclick = async () => {
    const dates = btn.dataset.pausedays.split(',');
    const pausable = dates.filter(d => isPausable({ on_date: d }, lunchState.purchasesByDate));
    if (!pausable.length) return;
    try {
      await pauseLunchDays(pausable, settings.daily_limit);
      await logLunchActivity(`Backfilled ${pausable.join(', ')} as paused — not tracked, not counted`);
      await reload(); render();
      toast((pausable.length > 1 ? pausable.join(', ') + ' paused' : pausable[0] + ' paused') + ' — skipped, not counted as banked');
    } catch (err) { toast("Couldn't pause that: " + err.message); }
  });
}

function openInlineAdd(onDate, needsDesc, presetAmount) {
  const el = document.getElementById('ladd-' + onDate);
  if (!el) return;
  el.className = 'lminline-add';
  el.innerHTML = `
    ${needsDesc ? `<input type="text" placeholder="What was it?" id="ldesc-${onDate}">` : ''}
    <input type="number" inputmode="decimal" min="0" step="0.01" id="lamt-${onDate}" ${presetAmount ? `value="${presetAmount}"` : ''}>
    <button class="lmgo" id="lgo-${onDate}">Log</button>
    <button class="lmcancel" id="lcancel-${onDate}">Cancel</button>`;
  el.hidden = false;
  document.getElementById('lamt-' + onDate).focus();
  document.getElementById('lcancel-' + onDate).onclick = () => { el.hidden = true; el.innerHTML = ''; };
  document.getElementById('lgo-' + onDate).onclick = async () => {
    const amount = parseFloat(document.getElementById('lamt-' + onDate).value);
    if (!isFinite(amount) || amount <= 0) return;
    const descInput = document.getElementById('ldesc-' + onDate);
    const label = needsDesc ? (descInput.value.trim() || 'Other') : 'Uber Eats';
    try {
      await logLunchPurchase({ onDate, label, amount, source: needsDesc ? 'manual' : 'ubereats', dailyLimit: lunchState.settings.daily_limit });
      await reload(); render();
      toast(`Logged — ${money(amount)} ${label}`);
    } catch (err) { toast("Couldn't log that: " + err.message); }
  };
}

function openUberPresets(onDate) {
  const el = document.getElementById('ladd-' + onDate);
  if (!el) return;
  el.className = 'lmpresetrow';
  el.innerHTML = UBER_PRESETS.map(amt => `<button class="lmpreset" data-preset="${amt}">$${amt}</button>`).join('') +
    `<button class="lmpreset custom" id="lcustom-${onDate}">Custom</button>
     <button class="lmcancel" id="lcancelpreset-${onDate}">Cancel</button>`;
  el.hidden = false;
  el.querySelectorAll('[data-preset]').forEach(b => b.onclick = async () => {
    try {
      await logLunchPurchase({ onDate, label: 'Uber Eats', amount: +b.dataset.preset, source: 'ubereats', dailyLimit: lunchState.settings.daily_limit });
      el.className = 'lminline-add';
      await reload(); render();
      toast(`Logged — $${b.dataset.preset} Uber Eats`);
    } catch (err) { toast("Couldn't log that: " + err.message); }
  });
  document.getElementById('lcustom-' + onDate).onclick = () => { el.className = 'lminline-add'; openInlineAdd(onDate, false); };
  document.getElementById('lcancelpreset-' + onDate).onclick = () => { el.hidden = true; el.innerHTML = ''; el.className = 'lminline-add'; };
}

function renderClosedWeeks(weeks) {
  const el = document.getElementById('lmClosedWeeks');
  if (!weeks.length) { el.innerHTML = `<div class="msoon"><div class="t">Nothing closed yet</div></div>`; return; }
  let html = '';
  weeks.forEach((w, i) => {
    const prior = weeks[i + 1];
    const gap = prior ? gapWeeksBetween(prior.weekStart, w.weekStart) : 0;
    const gapHTML = gap > 0 ? `<div class="lmgapmarker">— away ${gap === 1 ? 'about a week' : 'about ' + gap + ' weeks'} —</div>` : '';
    const isOpen = expandedWeeks.has(w.weekStart);
    const detail = !isOpen ? '' : `<div class="lmcwdetail">${w.days.map(d => {
      const dspent = daySpent(lunchState.purchasesByDate[d.on_date] || []);
      return `<div class="lmcwday${d.paused ? ' paused' : ''}">
        <span class="lmcwdn">${fmtD(pd(d.on_date))}</span>
        ${d.paused ? '<span class="lmcwstatus">⏸ paused</span>' : `<span class="lmcwamt mono">${money(dspent)}</span>`}
        ${chipsHTML(lunchState.purchasesByDate[d.on_date] || [], true)}
      </div>`;
    }).join('')}</div>`;
    const badges = w.hadPause ? '<span class="lmcwbadge">⏸️</span>' : '';
    html += `${gapHTML}<div class="lmclosedrow${isOpen ? ' open' : ''}" data-week="${w.weekStart}">
      <div class="lmclosedsummary">
        <span class="lmarrow">▸</span>
        <div class="lmlbl"><div class="w">Week of ${fmtD(pd(w.weekStart))}${badges}</div></div>
        <span class="lmtot mono">${money(w.spent)} / ${money(w.budget)}</span>
      </div>${detail}
    </div>`;
  });
  el.innerHTML = html;
  el.querySelectorAll('.lmclosedsummary').forEach(s => s.onclick = () => {
    const wk = s.closest('.lmclosedrow').dataset.week;
    expandedWeeks.has(wk) ? expandedWeeks.delete(wk) : expandedWeeks.add(wk);
    renderClosedWeeks(weeks);
  });
}

function renderZeroField() {
  const { settings } = lunchState;
  const el = document.getElementById('lmZeroField');
  el.innerHTML = `<button class="lmzerobtn" id="lmZeroBtn">Zero out rollover</button>
    <div class="lmhint">Resets your carried-forward balance to $0.00 — this week's own days still count normally off what you've logged.</div>`;
  let armed = false;
  const btn = document.getElementById('lmZeroBtn');
  btn.onclick = async () => {
    if (!armed) {
      armed = true;
      btn.textContent = 'Tap again to confirm';
      btn.classList.add('confirm');
      setTimeout(() => { armed = false; btn.textContent = 'Zero out rollover'; btn.classList.remove('confirm'); }, 4000);
      return;
    }
    try {
      await zeroLunchRollover(settings.user_id);
      await logLunchActivity('Rollover zeroed');
      await reload(); render();
      toast('Rollover zeroed — starting fresh from today');
    } catch (err) { toast("Couldn't zero that out: " + err.message); }
  };
}

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
