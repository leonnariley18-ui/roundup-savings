/* Ledger — Lunch: a $40/day budget with rollover
 *
 * Today is pinned at the top with the bank module attached directly to it —
 * the one card you always act on. Below it, the rest of the open week; below
 * that, closed weeks collapsed into history. There is no "close the week"
 * action anywhere — only days close, via End or Pause, and the week archives
 * itself the instant its last weekday (Friday) is resolved. That is not the
 * same moment a new week starts, though: Friday stays Friday (and reopenable)
 * straight through the weekend, until the real next Monday actually arrives —
 * checked fresh on every mount/render against today(), never a timer.
 */

import { today, add, mon, key, pd, fmtD, money } from '../dates.js';
import {
  loadLunch, logLunchPurchase, removeLunchPurchase, endLunchDay, reopenLunchDay,
  pauseLunchDays, resumeLunchDay, setLunchTrackingPaused, zeroLunchRollover, scheduleLunchLimit,
  cancelScheduledLunchLimit, advanceLunchWeek, logLunchActivity,
} from '../data.js';
import {
  WEEKDAYS, DOWS, daySpent, computeRollover, countsTowardRollover,
  unresolvedDays, priorUnresolved, isPausable, weekFullyResolved,
  weekDaysWithVirtuals, groupIntoWeeks, gapWeeksBetween, weekdaysOf,
} from '../lunch.js';
import { toast } from '../ui/toast.js';

const UBER_PRESETS = [18, 19, 20, 21, 22];

let host = null;
let lunchState = null;     // { settings, days, purchasesByDate, activity }
let expandedWeeks = new Set();
let addingTo = null;       // on_date of the day whose inline-add form is open
let addingKind = null;     // 'ubereats' | 'other'

export async function mount(el) {
  host = el;
  host.innerHTML = '<div class="soon"><div class="t">Loading…</div></div>';
  try {
    lunchState = await loadLunch();
    await maybeAdvanceWeek();
    render();
  } catch (err) {
    host.innerHTML = `<div class="soon"><div class="t">Couldn't load Lunch</div><div class="b">${err.message}</div></div>`;
  }
}

async function reload() {
  lunchState = await loadLunch();
  await maybeAdvanceWeek();
}

/* The one check that replaces every "Next day"/"Force next week" button the
 * mockup needed — run fresh on every load. If the open week is fully
 * resolved and the real date has moved past its Friday, fold it into
 * history and point open_week_start at today's actual week (jumping
 * straight there, however long the gap was, rather than stepping through
 * every week that passed). If it's not resolved, nothing here changes —
 * the stuck week just keeps showing, same as always. */
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
    const newBaseDate = key(fri);
    const nextMonday = mon(t);

    const patch = {
      rollover_base: newRolloverBase,
      rollover_base_date: newBaseDate,
      open_week_start: key(nextMonday),
    };
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

function render() {
  if (!host || !lunchState) return;
  const { settings, days, purchasesByDate, activity } = lunchState;
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
    <div class="lunchhead"><h1 class="serif" style="font-size:28px">\u{1F96A} Lunch</h1>
      <button class="lqbtn-ghost" id="lunchSettingsBtn" aria-label="Lunch settings">⚙</button>
    </div>
    <div id="lunchSettingsPanel" hidden></div>
    <div id="lunchToday"></div>
    <div id="lunchSummary"></div>
    <h2 class="sec">Rest of this week</h2>
    <div class="panel" id="lunchWeekPanel">
      <div class="weekhead">
        <div class="t">Mon ${fmtD(openWeekStart)} – Fri ${fmtD(fri)}</div>
        <span class="pausependingbadge" id="lunchPausePending" hidden></span>
      </div>
      <div id="lunchDays"></div>
    </div>
    <h2 class="sec">Closed weeks</h2>
    <div id="lunchClosedWeeks"></div>`;

  renderToday(todayDay, todayIdx, weekDays, openWeekStart, isWeekend);
  renderDays(weekDays, todayIdx, isWeekend);
  renderClosedWeeks(closedWeeks);

  document.getElementById('lunchPausePending').hidden = !settings.tracking_paused;
  if (settings.tracking_paused) {
    document.getElementById('lunchPausePending').textContent = isWeekend
      ? '⏸ Paused — will carry into next week until resumed'
      : '⏸ Paused — carries to each day until resumed';
  }

  document.getElementById('lunchSettingsBtn').onclick = () => {
    const panel = document.getElementById('lunchSettingsPanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderSettings();
  };
}

function renderToday(day, idx, weekDays, openWeekStart, isWeekend) {
  const { settings, purchasesByDate } = lunchState;
  const t = today();
  const purchases = purchasesByDate[day.on_date] || [];
  const spent = daySpent(purchases);
  const over = spent > day.daily_limit;
  const paused = settings.tracking_paused;
  const neverStarted = paused && lunchState.activity.length === 0;
  const rollover = computeRollover(settings, lunchState.days, purchasesByDate, t);
  const deficit = rollover < 0;

  if (neverStarted) {
    document.getElementById('lunchToday').innerHTML = `
      <div class="todaycard startprompt">
        <div class="label">\u{1F96A} Lunch tracking isn't on yet</div>
        <div class="startbody">Log Dunkin, Uber Eats, or anything else against a ${money(settings.daily_limit)}/day budget, with unspent days banked forward. Nothing's tracked, and nothing nags you, until you turn it on.</div>
        <button class="pausebtn start" id="lunchStartBtn">▶ Start tracking</button>
      </div>`;
    document.getElementById('lunchStartBtn').onclick = async () => {
      try {
        await setLunchTrackingPaused(settings.user_id, false);
        await logLunchActivity('Tracking started');
        await reload(); render();
        toast('Started — now tracking today');
      } catch (err) { toast("Couldn't start that: " + err.message); }
    };
    return;
  }

  const blockers = paused ? [] : priorUnresolved(weekDays, isWeekend ? t : t);
  const blocked = blockers.length > 0;
  const dn = DOWS[idx];
  const dd = fmtD(pd(day.on_date));

  const bankHTML = paused
    ? `<div class="amt">⏸ Not tracking</div><div class="sub">log "start tracking" to begin</div>`
    : `<div class="amt">${deficit ? '' : '+'}${money(rollover)}</div><div class="sub">${deficit ? 'in the hole' : 'banked'}</div>`;

  let bodyHTML;
  if (paused) {
    bodyHTML = `<div class="todaystatus paused">Not tracking — nothing is logged until you start</div>${chipsHTML(day, purchases, true)}`;
  } else {
    bodyHTML = `<div class="todayspent"><span class="v mono">${money(spent)}</span><span class="target">${money(day.daily_limit)} target</span></div>
      <div class="todaystatus ${over ? 'over' : 'under'}">
        ${over ? '⚠ ' + money(spent - day.daily_limit) + ' over' : money(day.daily_limit - spent) + ' under'}
        ${day.ended_at ? '<span class="endedbadge">✓ ended</span>' : ''}
      </div>`;
  }

  const locked = !!day.ended_at;
  const dayIsPausable = isPausable(day, purchasesByDate);

  const pausableBlockers = blockers.filter(d => isPausable(d, purchasesByDate));
  const blockHTML = !blocked ? '' : `
    <div class="blockbanner"><b>${blockers.map(d => DOWS[weekDays.findIndex(w => w.on_date === d.on_date)] + ' ' + fmtD(pd(d.on_date))).join(', ')}
      ${blockers.length > 1 ? ' aren’t' : ' isn’t'} finished yet.</b> Before you can log anything new today —
      <div class="gorow">
        ${blockers.map(d => `<button class="gobtn" data-endday="${d.on_date}">End ${DOWS[weekDays.findIndex(w => w.on_date === d.on_date)]}</button>`).join('')}
        ${pausableBlockers.length ? `<button class="gobtn pause" data-pausedays="${pausableBlockers.map(d => d.on_date).join(',')}">Pause ${pausableBlockers.map(d => DOWS[weekDays.findIndex(w => w.on_date === d.on_date)]).join(', ')} instead</button>` : ''}
      </div>
      <div class="hint">End if you remember what you spent — log it on its own row below first.
        ${pausableBlockers.length ? 'Pause is offered for whichever of those days have nothing logged.' : 'None of these can be paused — they already have purchases logged.'}</div>
    </div>`;

  const weekendNote = (!isWeekend || weekFullyResolved(openWeekStart, weekDays)) ? '' : `
    <div class="blockbanner"><b>It's the weekend — ${dn} ${dd} is still open.</b>
      No rush, but it'll need wrapping up before Monday.
      ${dayIsPausable ? `<div class="gorow"><button class="gobtn pause" data-pausedays="${day.on_date}">Pause ${dn} instead</button></div>` : ''}
      <div class="hint">${dayIsPausable ? 'End it above if you remember what you spent.' : 'It already has purchases — it can only be ended, not paused.'}</div>
    </div>`;

  const weekDoneNote = (!isWeekend || !weekFullyResolved(openWeekStart, weekDays)) ? '' : `
    <div class="hint" style="margin-top:12px">All set for the week. Nothing to do until Monday.</div>`;

  const actionArea = paused ? '' : blocked ? blockHTML :
    chipsHTML(day, purchases, locked) + quickAddHTML(day.on_date, locked, true) + endBtnHTML(day) + reopenBtnHTML(day);

  const pauseBtn = (!paused && spent > 0)
    ? `<span class="pausebtn disabled" title="Already logged something today — can only be ended, not paused">⏸ Pause tracking</span>`
    : `<button class="pausebtn" id="lunchPauseBtn">${paused ? '▶ Start tracking' : '⏸ Pause tracking'}</button>`;

  document.getElementById('lunchToday').innerHTML = `
    <div class="todaycard ${paused ? 'paused' : deficit ? 'deficit' : ''}">
      <div class="todayhead">
        <div><div class="label">${isWeekend ? dn + '’s record' : 'Today'} · ${dn} ${dd}</div>${bodyHTML}</div>
        <div class="todaybank">${bankHTML}${pauseBtn}</div>
      </div>
      ${actionArea}${weekendNote}${weekDoneNote}
    </div>`;

  wireDayActions(document.getElementById('lunchToday'), day.on_date);

  const pauseBtnEl = document.getElementById('lunchPauseBtn');
  if (pauseBtnEl) pauseBtnEl.onclick = async () => {
    const next = !paused;
    try {
      await setLunchTrackingPaused(settings.user_id, next);
      await logLunchActivity(next ? 'Tracking paused — fell off, not counting days until started again' : 'Tracking started');
      if (next) await pauseLunchDays([day.on_date], settings.daily_limit);
      else await resumeLunchDay(day.on_date);
      await reload();
      render();
      toast(next ? 'Paused — not logging until you start again' : 'Started — now tracking today');
    } catch (err) { toast("Couldn't update that: " + err.message); }
  };
}

function renderDays(weekDays, todayIdx, isWeekend) {
  const { settings, purchasesByDate } = lunchState;
  const html = weekDays.map((day, i) => {
    if (i === todayIdx) {
      return `<div class="todaymark">${DOWS[i]} ${fmtD(pd(day.on_date))} ${isWeekend ? '— shown above' : '— today, shown above'}</div>`;
    }
    const purchases = purchasesByDate[day.on_date] || [];
    const spent = daySpent(purchases);
    const isFuture = pd(day.on_date) > today();
    const locked = day.paused || !!day.ended_at || isFuture;
    let statusHTML;
    if (day.paused) {
      statusHTML = `<span class="s">⏸ paused</span>`;
    } else if (purchases.length || !isFuture) {
      const over = spent > day.daily_limit;
      statusHTML = `<span class="s ${over ? 'over' : 'under'}">${over ? '⚠ ' + money(spent - day.daily_limit) + ' over' : money(day.daily_limit - spent) + ' under'}${day.ended_at ? ' ✓' : ''}</span>`;
    } else {
      statusHTML = `<span class="s">—</span>`;
    }
    return `<div class="lday${isFuture && !purchases.length && !day.paused ? ' future' : ''}${locked ? ' locked' : ''}">
      <div class="dayrow">
        <div class="dwho"><div class="dn">${DOWS[i]} ${fmtD(pd(day.on_date))}</div></div>
        <span class="target">${money(day.daily_limit)} target</span>
        <div class="dspent"><div class="v ${day.paused ? '' : spent > day.daily_limit ? 'over' : spent > 0 ? 'under' : ''} mono">${day.paused ? '—' : money(spent)}</div>${statusHTML}</div>
      </div>
      ${chipsHTML(day, purchases, locked)}${quickAddHTML(day.on_date, locked, false)}${endBtnHTML(day)}
    </div>`;
  }).join('');

  const el = document.getElementById('lunchDays');
  el.innerHTML = html;
  weekDays.forEach(day => wireDayActions(el, day.on_date));
}

function chipsHTML(day, purchases, locked) {
  if (!purchases.length) return '';
  return `<div class="chips">${purchases.map(p => `<div class="lchip"><b>${esc(p.label)}</b> ${money(p.amount)}${locked ? '' : ` <button data-removepurchase="${p.id}" aria-label="Remove">×</button>`}</div>`).join('')}</div>`;
}

function quickAddHTML(onDate, locked, big) {
  if (locked) return '';
  return `<div class="quickrow${big ? ' big' : ''}">
    <button class="lqbtn" data-dunkin="${onDate}">☕ Dunkin <span class="amt">$5</span></button>
    <button class="lqbtn" data-ubereats="${onDate}">\u{1F354} Uber Eats</button>
    <button class="lqbtn" data-other="${onDate}">+ Other</button>
  </div><div class="inline-add" id="add-${onDate}" hidden></div>`;
}

/* Only a day that's already happened (today included) needs ending —
 * nothing to finish on a day that hasn't arrived yet. */
function endBtnHTML(day) {
  if (day.ended_at || day.paused) return '';
  if (pd(day.on_date) > today()) return '';
  return `<button class="endbtn" data-endday="${day.on_date}">End day</button>`;
}

/* Only ever rendered from renderToday() for the day currently parked as
 * "today" (or Friday, over the weekend) — so no extra "is this actually
 * today" check is needed here; the call site already guarantees it. */
function reopenBtnHTML(day) {
  if (!day.ended_at) return '';
  return `<button class="endbtn" data-reopenday="${day.on_date}">Reopen day</button>`;
}

function wireDayActions(root, onDate) {
  const { settings } = lunchState;

  root.querySelectorAll(`[data-removepurchase]`).forEach(btn => btn.onclick = async () => {
    try { await removeLunchPurchase(btn.dataset.removepurchase); await reload(); render(); toast('Removed'); }
    catch (err) { toast("Couldn't remove that: " + err.message); }
  });

  const dunkinBtn = root.querySelector(`[data-dunkin="${onDate}"]`);
  if (dunkinBtn) dunkinBtn.onclick = async () => {
    try {
      await logLunchPurchase({ onDate, label: 'Dunkin', amount: 5, source: 'dunkin', dailyLimit: settings.daily_limit });
      await reload(); render(); toast('Logged — $5 Dunkin');
    } catch (err) { toast("Couldn't log that: " + err.message); }
  };

  const otherBtn = root.querySelector(`[data-other="${onDate}"]`);
  if (otherBtn) otherBtn.onclick = () => openInlineAdd(onDate, 'other');

  const uberBtn = root.querySelector(`[data-ubereats="${onDate}"]`);
  if (uberBtn) uberBtn.onclick = () => openUberPresets(onDate);

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

function openInlineAdd(onDate, kind, presetAmount) {
  const el = document.getElementById('add-' + onDate);
  if (!el) return;
  const needsDesc = kind === 'other';
  el.className = 'inline-add';
  el.innerHTML = `
    ${needsDesc ? `<input type="text" placeholder="What was it?" id="desc-${onDate}" style="width:120px">` : ''}
    <input type="number" inputmode="decimal" min="0" step="0.01" id="amt-${onDate}" ${presetAmount ? `value="${presetAmount}"` : ''}>
    <button class="go" id="go-${onDate}">Log</button>
    <button class="cancel" id="cancel-${onDate}">Cancel</button>`;
  el.hidden = false;
  const amtInput = document.getElementById('amt-' + onDate);
  amtInput.focus();
  document.getElementById('cancel-' + onDate).onclick = () => { el.hidden = true; el.innerHTML = ''; };
  document.getElementById('go-' + onDate).onclick = async () => {
    const amount = parseFloat(amtInput.value);
    if (!isFinite(amount) || amount <= 0) { amtInput.focus(); return; }
    const descInput = document.getElementById('desc-' + onDate);
    const label = needsDesc ? (descInput.value.trim() || 'Other') : 'Uber Eats';
    try {
      await logLunchPurchase({ onDate, label, amount, source: needsDesc ? 'manual' : 'ubereats', dailyLimit: lunchState.settings.daily_limit });
      await reload(); render();
      toast(`Logged — ${money(amount)} ${label}`);
    } catch (err) { toast("Couldn't log that: " + err.message); }
  };
}

function openUberPresets(onDate) {
  const el = document.getElementById('add-' + onDate);
  if (!el) return;
  el.className = 'presetrow';
  el.innerHTML = UBER_PRESETS.map(amt => `<button class="preset" data-preset="${amt}">$${amt}</button>`).join('') +
    `<button class="preset custom" id="customAmt-${onDate}">Custom amount</button>
     <button class="cancel" id="cancelpreset-${onDate}">Cancel</button>`;
  el.hidden = false;
  el.querySelectorAll('[data-preset]').forEach(b => b.onclick = async () => {
    try {
      await logLunchPurchase({ onDate, label: 'Uber Eats', amount: +b.dataset.preset, source: 'ubereats', dailyLimit: lunchState.settings.daily_limit });
      el.className = 'inline-add';
      await reload(); render();
      toast(`Logged — $${b.dataset.preset} Uber Eats`);
    } catch (err) { toast("Couldn't log that: " + err.message); }
  });
  document.getElementById('customAmt-' + onDate).onclick = () => { el.className = 'inline-add'; openInlineAdd(onDate, 'ubereats'); };
  document.getElementById('cancelpreset-' + onDate).onclick = () => { el.hidden = true; el.innerHTML = ''; el.className = 'inline-add'; };
}

function renderClosedWeeks(weeks) {
  const el = document.getElementById('lunchClosedWeeks');
  if (!weeks.length) { el.innerHTML = `<div class="soon"><div class="t">Nothing closed yet</div></div>`; return; }

  let html = '';
  weeks.forEach((w, i) => {
    const prior = weeks[i + 1];
    const gap = prior ? gapWeeksBetween(prior.weekStart, w.weekStart) : 0;
    if (gap > 0) {
      html = html; // gap renders above this week, appended before it below
    }
    const gapHTML = gap > 0 ? `<div class="gapmarker">— away ${gap === 1 ? 'about a week' : 'about ' + gap + ' weeks'} — nothing logged, nothing to show —</div>` : '';
    const isOpen = expandedWeeks.has(w.weekStart);
    const detail = !isOpen ? '' : `<div class="cwdetail">${w.days.map(d => {
      const dspent = daySpent(lunchState.purchasesByDate[d.on_date] || []);
      return `<div class="cwday${d.paused ? ' paused' : ''}">
        <span class="cwdn">${fmtD(pd(d.on_date))}</span>
        ${d.paused ? `<span class="cwstatus">⏸ paused</span>` : `<span class="cwamt mono">${money(dspent)}</span>`}
        ${chipsHTML(d, lunchState.purchasesByDate[d.on_date] || [], true)}
      </div>`;
    }).join('')}</div>`;
    const badges = (w.hadPause ? `<span class="cwbadge" title="Included a paused day">⏸️</span>` : '');
    html += `${gapHTML}<div class="closedrow${isOpen ? ' open' : ''}" data-week="${w.weekStart}">
      <div class="closedsummary">
        <span class="arrow">▸</span>
        <div class="lbl"><div class="w">Week of ${fmtD(pd(w.weekStart))}${badges}</div><div class="d">closed</div></div>
        <span class="tot mono">${money(w.spent)} / ${money(w.budget)}</span>
      </div>${detail}
    </div>`;
  });
  el.innerHTML = html;
  el.querySelectorAll('.closedsummary').forEach(s => s.onclick = () => {
    const wk = s.closest('.closedrow').dataset.week;
    expandedWeeks.has(wk) ? expandedWeeks.delete(wk) : expandedWeeks.add(wk);
    renderClosedWeeks(weeks);
  });
}

function renderSettings() {
  const { settings, activity } = lunchState;
  const panel = document.getElementById('lunchSettingsPanel');

  const mondays = [];
  let cursor = add(mon(today()), 7);
  for (let i = 0; i < 8; i++) { mondays.push(new Date(cursor)); cursor = add(cursor, 7); }

  panel.innerHTML = `
    <h2 class="sec">Settings</h2>
    <div class="field">
      <span class="label">Daily limit</span>
      <div class="currentlimit mono">${money(settings.daily_limit)} / day</div>
      ${settings.scheduled_limit != null ? `
        <div class="scheduledbox">Scheduled: <b>${money(settings.scheduled_limit)}</b> starting Mon ${fmtD(pd(settings.scheduled_limit_monday))}
          <br><button id="cancelScheduled">Cancel this change</button></div>` : `
        <div class="amtin"><span>$</span><input id="newLimitInput" type="number" min="1" step="1" placeholder="New amount"></div>
        <select class="mselect" id="limitMondaySelect">${mondays.map(d => `<option value="${key(d)}">Mon ${fmtD(d)}</option>`).join('')}</select>
        <button class="zerobtn" id="scheduleLimitBtn">Schedule change</button>`}
      <div class="hint">Changes only ever take effect on a Monday — schedule one instead of editing it mid-week.</div>
    </div>
    <div class="field">
      <button class="zerobtn" id="zeroBtn">Zero out rollover</button>
      <div class="hint">Resets your carried-forward balance to $0.00. This week's own days still count normally — nothing here touches your purchase history.</div>
    </div>
    <div class="field">
      <span class="label">Activity</span>
      <div class="activitylog">${activity.map(a => `<div class="activityrow"><span class="ad">${fmtD(new Date(a.created_at))}</span><span class="at">${esc(a.text)}</span></div>`).join('') || '<div class="hint">Nothing yet</div>'}</div>
    </div>`;

  const scheduleBtn = document.getElementById('scheduleLimitBtn');
  if (scheduleBtn) scheduleBtn.onclick = async () => {
    const v = parseFloat(document.getElementById('newLimitInput').value);
    if (!isFinite(v) || v <= 0) { toast('Enter an amount first'); return; }
    const monday = document.getElementById('limitMondaySelect').value;
    try {
      await scheduleLunchLimit(settings.user_id, v, monday);
      await logLunchActivity(`Scheduled ${money(v)}/day starting ${fmtD(pd(monday))}`);
      await reload(); render();
      document.getElementById('lunchSettingsPanel').hidden = false;
      renderSettings();
      toast(`Scheduled — ${money(v)} takes effect Mon ${fmtD(pd(monday))}`);
    } catch (err) { toast("Couldn't schedule that: " + err.message); }
  };

  const cancelBtn = document.getElementById('cancelScheduled');
  if (cancelBtn) cancelBtn.onclick = async () => {
    try {
      await cancelScheduledLunchLimit(settings.user_id);
      await logLunchActivity('Cancelled scheduled limit change');
      await reload(); render();
      document.getElementById('lunchSettingsPanel').hidden = false;
      renderSettings();
      toast('Scheduled change cancelled');
    } catch (err) { toast("Couldn't cancel that: " + err.message); }
  };

  let zeroArmed = false;
  const zeroBtn = document.getElementById('zeroBtn');
  zeroBtn.onclick = async () => {
    if (!zeroArmed) {
      zeroArmed = true;
      zeroBtn.textContent = 'Click again to confirm';
      zeroBtn.classList.add('confirm');
      setTimeout(() => { zeroArmed = false; zeroBtn.textContent = 'Zero out rollover'; zeroBtn.classList.remove('confirm'); }, 4000);
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
