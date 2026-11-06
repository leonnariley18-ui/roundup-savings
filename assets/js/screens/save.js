/* Ledger — Save: sweeping Lunch's banked rollover into actual savings
 *
 * Every Monday since you started (or since your last sweep) opens as its
 * own week immediately — no "finished vs in progress" distinction, a week
 * is just open until it's swept. Sweeping wraps up every open week at
 * once, whole-week atomic; it doesn't require Friday to have passed.
 * Banked is pulled live from Lunch's own rollover, never stored here.
 */

import { today, add, mon, key, pd, fmtD, money } from '../dates.js';
import {
  loadSave, logSaveActivity, startSaveTracking, scheduleSaveTarget,
  cancelScheduledSaveTarget, applyDueScheduledTarget, logSaveSweep, reduceLunchRollover,
  loadLunch,
} from '../data.js';
import {
  weeklyMondays, targetForWeek, openWeeks, targetTotal, clampTreat, savedAmount, delta, neverStarted,
} from '../save.js';
import { weekdaysOf, computeRollover } from '../lunch.js';
import { toast } from '../ui/toast.js';

let host = null;
let saveState = null;   // { settings, history, sweeps, activity }
let lunchState = null;  // same shape loadLunch() returns
let expandedSweeps = new Set();
let showAllTime = false;
let treatOpen = false;

export async function mount(el) {
  host = el;
  host.innerHTML = '<div class="soon"><div class="t">Loading…</div></div>';
  try {
    await reload();
    await maybeApplyScheduledTarget();
    render();
  } catch (err) {
    host.innerHTML = `<div class="soon"><div class="t">Couldn't load Save</div><div class="b">${err.message}</div></div>`;
  }
}

async function reload() {
  [saveState, lunchState] = await Promise.all([loadSave(), loadLunch()]);
}

async function maybeApplyScheduledTarget() {
  const { settings } = saveState;
  if (settings.scheduled_target == null) return;
  const thisMonday = key(mon(today()));
  if (settings.scheduled_target_monday > thisMonday) return;
  await applyDueScheduledTarget(settings.user_id, settings.scheduled_target, settings.scheduled_target_monday);
  await logSaveActivity(`Weekly target changed to ${money(settings.scheduled_target)} (as scheduled)`);
  saveState = await loadSave();
}

function bankedNow() {
  return computeRollover(lunchState.settings, lunchState.days, lunchState.purchasesByDate, today());
}

/* A week "had paused activity" if any Lunch day inside it was explicitly
 * paused — the same signal Lunch's own closed-weeks history badges. */
function weekHadPause(monday) {
  const days = weekdaysOf(pd(monday)).map(key);
  return lunchState.days.some(d => days.includes(d.on_date) && d.paused);
}

function render() {
  if (!host || !saveState) return;
  const { settings } = saveState;

  host.innerHTML = `
    <div class="savehead"><h1 class="serif" style="font-size:28px">\u{1F4B0} Save</h1>
      <button class="sqbtn-ghost" id="saveSettingsBtn" aria-label="Save settings">⚙</button>
    </div>
    <div class="sidepanel" id="saveSettingsPanel">
      <div class="sc" id="saveSettingsScrim"></div>
      <div class="pan">
        <div class="ph"><span class="t serif">Settings</span><button id="saveSettingsClose" aria-label="Close">&times;</button></div>
        <div id="saveSettingsBody"></div>
      </div>
    </div>
    <div id="saveBody"></div>`;

  document.getElementById('saveSettingsBtn').onclick = () => {
    renderSettings();
    document.getElementById('saveSettingsPanel').classList.add('open');
  };
  document.getElementById('saveSettingsScrim').onclick = closeSaveSettings;
  document.getElementById('saveSettingsClose').onclick = closeSaveSettings;

  if (neverStarted(settings)) {
    renderStartPrompt();
  } else {
    renderBody();
  }
}

function closeSaveSettings() {
  document.getElementById('saveSettingsPanel')?.classList.remove('open');
}

function renderStartPrompt() {
  const mondays = [];
  let cursor = mon(today());
  for (let i = 0; i < 8; i++) { mondays.unshift(new Date(cursor)); cursor = add(cursor, -7); }

  document.getElementById('saveBody').innerHTML = `
    <div class="startprompt">
      <div class="sp-label">\u{1F4B0} Save isn't tracking yet</div>
      <div class="sp-body">Set a weekly target and pick which week to start from — every Monday after that opens as its own week, closeable whenever you sweep.</div>
      <div class="sp-row">
        <div class="sf-field" style="flex:0 0 140px;text-align:left">
          <span class="lbl">Weekly target</span>
          <div class="amtin"><span>$</span><input type="number" id="startTargetInput" value="40" min="1" step="1"></div>
        </div>
        <div class="sf-field" style="text-align:left">
          <span class="lbl">Start from</span>
          <select class="mselect" id="startMondaySelect" style="margin-top:0">
            ${mondays.map((d, i) => `<option value="${key(d)}"${i === mondays.length - 1 ? ' selected' : ''}>Mon ${fmtD(d)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="hint" style="text-align:left">Only past or current Mondays — picking one further back means more open weeks waiting the first time you look.</div>
      <div class="sf-actions" style="justify-content:center;margin-top:20px"><button class="go" id="startSaveBtn">Start tracking</button></div>
    </div>`;

  document.getElementById('startSaveBtn').onclick = async () => {
    const target = parseFloat(document.getElementById('startTargetInput').value);
    if (!isFinite(target) || target <= 0) { toast('Enter a weekly target first'); return; }
    const monday = document.getElementById('startMondaySelect').value;
    try {
      await startSaveTracking(saveState.settings.user_id, target, monday);
      await logSaveActivity(`Weekly target set to ${money(target)}`);
      await reload();
      render();
      toast('Started — tracking from Mon ' + fmtD(pd(monday)));
    } catch (err) { toast("Couldn't start that: " + err.message); }
  };
}

function renderBody() {
  const { settings, history, sweeps } = saveState;
  const banked = bankedNow();
  const deficit = banked < 0;
  const thisMonday = key(mon(today()));
  const weeks = settings.open_week_start && settings.open_week_start <= thisMonday
    ? openWeeks(settings.open_week_start, thisMonday, history)
    : [];

  const body = document.getElementById('saveBody');
  body.innerHTML = `
    <div class="readycard${deficit ? ' deficit' : ''}">
      <div class="readyamt">
        <div class="big">${money(banked)}</div>
        <div class="src">banked in Lunch right now</div>
      </div>
    </div>
    <div id="saveOpenArea"></div>
    <h2 class="sec">When you moved it</h2>
    <div class="panel" id="saveHistoryPanel"></div>
    <div class="allsection" id="saveAllSection">
      <div class="toprow"><div><div class="al">All-time swept</div><div class="av">${money(allTimeSwept(sweeps))}</div></div></div>
      <div class="alltreat${showAllTime ? ' open' : ''}"><div class="al">All-time treats</div><div class="av">${money(allTimeTreated(sweeps))}</div></div>
    </div>`;

  renderOpenArea(weeks, banked, deficit);
  renderHistory(sweeps);

  document.getElementById('saveAllSection').onclick = () => {
    showAllTime = !showAllTime;
    document.querySelector('.allsection .alltreat').classList.toggle('open', showAllTime);
  };
}

const allTimeSwept = sweeps => sweeps.reduce((s, r) => s + Number(r.total_amount), 0);
const allTimeTreated = sweeps => sweeps.reduce((s, r) => s + Number(r.treat_amount), 0);

function renderOpenArea(weeks, banked, deficit) {
  const area = document.getElementById('saveOpenArea');
  const { settings } = saveState;

  if (!weeks.length) {
    area.innerHTML = `
      <div class="emptystate">
        <div class="et">Nothing open right now</div>
        <div class="es">Next open week starts <b style="color:var(--muted)">Mon ${fmtD(pd(settings.open_week_start))}</b>. Nothing to do here until then.</div>
      </div>`;
    return;
  }

  const weekRows = weeks.map(w => `
    <div class="wkrow"><span class="wdates">Week of ${fmtD(pd(w.monday))} – ${fmtD(add(pd(w.monday), 4))}${weekHadPause(w.monday) ? '<span class="pausedbadge" title="Lunch was paused for part of this week">⏸️</span>' : ''}</span>
      <span class="wlimit mono">${money(w.target)} target</span></div>`).join('');

  area.innerHTML = `
    <h2 class="sec">Open weeks<span class="n">— since your last sweep</span></h2>
    <div class="openweeks">${weekRows}</div>
    <div id="saveSweepArea"></div>`;

  if (!deficit) {
    renderSweepForm(weeks);
  } else {
    document.getElementById('saveSweepArea').innerHTML = `
      <div class="emptystate">
        <div class="et">Nothing to sweep right now</div>
        <div class="es">Lunch is in the hole — there's nothing banked to sweep until that's back above zero.</div>
      </div>`;
  }
}

function renderSweepForm(weeks) {
  const banked = bankedNow();
  const target = targetTotal(weeks);
  const uniform = weeks.every(w => w.target === weeks[0].target);
  const targetLabel = uniform
    ? `Target — ${weeks.length} week${weeks.length === 1 ? '' : 's'} × ${money(weeks[0].target)}`
    : `Target — ${weeks.length} weeks (target changed partway)`;

  document.getElementById('saveSweepArea').innerHTML = `
    <div class="sweepform">
      <span class="label">Log a sweep — wraps up ${weeks.length} open week${weeks.length === 1 ? '' : 's'}</span>
      <div class="sf-row">
        <div class="sf-field" style="flex:0 0 160px">
          <span class="lbl">Total amount</span>
          <div class="amtin"><span>$</span><input type="number" id="sweepAmt" value="${banked.toFixed(2)}" step="0.01" min="0"></div>
        </div>
        <div class="sf-field">
          <span class="lbl">Note <span style="opacity:.6">(optional)</span></span>
          <input type="text" id="sweepNote" placeholder="e.g. Marcus HYSA">
        </div>
      </div>

      <button class="treatbtn" id="treatToggleBtn">✨ Keep part of this as a treat</button>
      <div class="treatform" id="treatForm" ${treatOpen ? '' : 'hidden'}>
        <div class="sf-field" style="flex:0 0 140px">
          <span class="lbl">Treat amount</span>
          <div class="amtin"><span>$</span><input type="number" id="treatAmt" step="0.01" min="0" placeholder="0.00"></div>
        </div>
        <div class="sf-hint" style="margin-top:12px;padding-top:0;border-top:0">Comes out of the total above — the rest is what actually counts as saved.</div>
      </div>

      <div class="expectbox">
        <span class="el" id="targetLabel">${targetLabel}</span>
        <span class="ev">${money(target)}</span>
      </div>
      <div class="savedline" id="savedLine" hidden>Saved $<span id="savedAmtText">0.00</span> — $<span id="treatAmtText">0.00</span> kept as a treat</div>
      <div class="deltaline" id="deltaLine"></div>

      <div class="sf-hint">Logged as today. Subtracts the full total from what Lunch shows as banked — same idea as "Zero out rollover" in Lunch, but only for what you actually swept, not the whole thing.</div>

      <div class="sf-actions"><button class="go" id="logSweepBtn">Log sweep</button></div>
    </div>`;

  const amtInput = document.getElementById('sweepAmt');
  const treatAmtInput = document.getElementById('treatAmt');
  const treatForm = document.getElementById('treatForm');
  const savedLine = document.getElementById('savedLine');
  const deltaLine = document.getElementById('deltaLine');

  function refresh() {
    const total = parseFloat(amtInput.value) || 0;
    let treat = treatForm.hidden ? 0 : (parseFloat(treatAmtInput.value) || 0);
    treat = clampTreat(total, treat);
    if (!treatForm.hidden && treatAmtInput.value && parseFloat(treatAmtInput.value) !== treat) treatAmtInput.value = treat.toFixed(2);

    const saved = savedAmount(total, treat);
    savedLine.hidden = treat <= 0;
    document.getElementById('savedAmtText').textContent = saved.toFixed(2);
    document.getElementById('treatAmtText').textContent = treat.toFixed(2);

    const d = delta(saved, target);
    deltaLine.textContent = (d >= 0 ? '+' : '-') + money(Math.abs(d)) + (d >= 0 ? ' ahead of the weekly target' : ' behind the weekly target');
    deltaLine.className = 'deltaline ' + (d >= 0 ? 'ahead' : 'behind');
  }
  amtInput.addEventListener('input', refresh);
  treatAmtInput.addEventListener('input', refresh);
  refresh();

  document.getElementById('treatToggleBtn').onclick = () => {
    treatOpen = treatForm.hidden;
    treatForm.hidden = !treatOpen;
    if (!treatOpen) treatAmtInput.value = '';
    refresh();
  };

  document.getElementById('logSweepBtn').onclick = async () => {
    const total = parseFloat(amtInput.value) || 0;
    const treat = clampTreat(total, treatForm.hidden ? 0 : (parseFloat(treatAmtInput.value) || 0));
    const note = document.getElementById('sweepNote').value.trim();
    try {
      await logSaveSweep(saveState.settings.user_id, {
        sweptOn: key(today()),
        weeksFrom: weeks[0].monday,
        weeksTo: weeks[weeks.length - 1].monday,
        weeksCount: weeks.length,
        targetTotal: target,
        totalAmount: total,
        treatAmount: treat,
        note,
      });
      await reduceLunchRollover(saveState.settings.user_id, total, banked);
      treatOpen = false;
      await reload();
      render();
      toast('Swept ' + money(total));
    } catch (err) { toast("Couldn't log that: " + err.message); }
  };
}

function renderHistory(sweeps) {
  const el = document.getElementById('saveHistoryPanel');
  if (!sweeps.length) { el.innerHTML = `<div class="soon"><div class="t">Nothing swept yet</div></div>`; return; }

  el.innerHTML = sweeps.map(s => {
    const isOpen = expandedSweeps.has(s.id);
    const saved = Number(s.total_amount) - Number(s.treat_amount);
    const d = saved - Number(s.target_total);
    const weekLines = weeklyMondays(s.weeks_from, s.weeks_to).map(monday => `
      <div class="sdrow"><span class="k">Week of ${fmtD(pd(monday))} – ${fmtD(add(pd(monday), 4))}${weekHadPause(monday) ? '<span class="pausedbadge" title="Lunch was paused for part of this week">⏸️</span>' : ''}</span>
        <span class="v">${money(targetForWeek(saveState.history, monday) ?? 0)}</span></div>`).join('');

    return `
      <div class="sweeprow${isOpen ? ' open' : ''}" data-id="${s.id}">
        <div class="sweepsummary">
          <span class="swarrow">▸</span>
          <div class="ssum-main"><div class="when">${fmtD(pd(s.swept_on))}</div>${s.note ? `<div class="swnote">📝 ${esc(s.note)}</div>` : ''}</div>
          <div class="ssum-right"><div class="amt mono">${money(s.total_amount)}</div></div>
        </div>
        <div class="sweepdetail">
          ${weekLines}
          <div class="sdrow total"><span class="k">Target</span><span class="v">${money(s.target_total)}</span></div>
          ${Number(s.treat_amount) > 0 ? `
            <div class="sdrow treat"><span class="k">✨ Treat Yourself!</span><span class="v">${money(s.treat_amount)}</span></div>
            <div class="sdrow total"><span class="k">Actually saved</span><span class="v">${money(saved)}</span></div>` : ''}
          <div class="sddelta ${d >= 0 ? 'ahead' : 'behind'}">${d >= 0 ? '+' : '-'}${money(Math.abs(d))} ${d >= 0 ? 'ahead' : 'behind'} of the weekly target</div>
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('.sweepsummary').forEach(s => s.onclick = () => {
    const id = s.closest('.sweeprow').dataset.id;
    expandedSweeps.has(id) ? expandedSweeps.delete(id) : expandedSweeps.add(id);
    renderHistory(saveState.sweeps);
  });
}

function renderSettings() {
  const { settings, activity } = saveState;
  const body = document.getElementById('saveSettingsBody');

  const mondays = [];
  let cursor = add(mon(today()), 7);
  for (let i = 0; i < 8; i++) { mondays.push(new Date(cursor)); cursor = add(cursor, 7); }

  body.innerHTML = `
    <div class="field">
      <span class="label">Weekly target</span>
      <div class="currentlimit mono">${settings.weekly_target != null ? money(settings.weekly_target) + ' / week' : 'not set'}</div>
      ${settings.scheduled_target != null ? `
        <div class="scheduledbox">Scheduled: <b>${money(settings.scheduled_target)}</b> starting Mon ${fmtD(pd(settings.scheduled_target_monday))}
          <br><button id="cancelScheduled">Cancel this change</button></div>` : `
        <div class="amtin"><span>$</span><input id="newTargetInput" type="number" min="1" step="1" placeholder="0"></div>
        <select class="mselect" id="targetMondaySelect">${mondays.map(d => `<option value="${key(d)}">Mon ${fmtD(d)}</option>`).join('')}</select>
        <button class="zerobtn" id="scheduleTargetBtn">Schedule change</button>`}
      <div class="hint">Changes only ever take effect on a Monday — schedule one instead of editing it mid-week. A week already on the open list keeps whatever target was active when it opened.</div>
    </div>
    <div class="field">
      <span class="label">Activity</span>
      <div class="activitylog">${activity.map(a => `<div class="activityrow"><span class="ad">${fmtD(new Date(a.created_at))}</span><span class="at">${esc(a.text)}</span></div>`).join('') || '<div class="hint">Nothing yet</div>'}</div>
    </div>`;

  const scheduleBtn = document.getElementById('scheduleTargetBtn');
  if (scheduleBtn) scheduleBtn.onclick = async () => {
    const v = parseFloat(document.getElementById('newTargetInput').value);
    if (!isFinite(v) || v <= 0) { toast('Enter an amount first'); return; }
    const monday = document.getElementById('targetMondaySelect').value;
    try {
      await scheduleSaveTarget(settings.user_id, v, monday);
      await logSaveActivity(`Scheduled ${money(v)}/week starting ${fmtD(pd(monday))}`);
      await reload(); render();
      document.getElementById('saveSettingsPanel').classList.add('open');
      renderSettings();
      toast(`Scheduled — ${money(v)} takes effect Mon ${fmtD(pd(monday))}`);
    } catch (err) { toast("Couldn't schedule that: " + err.message); }
  };

  const cancelBtn = document.getElementById('cancelScheduled');
  if (cancelBtn) cancelBtn.onclick = async () => {
    try {
      await cancelScheduledSaveTarget(settings.user_id);
      await logSaveActivity('Cancelled scheduled target change');
      await reload(); render();
      document.getElementById('saveSettingsPanel').classList.add('open');
      renderSettings();
      toast('Scheduled change cancelled');
    } catch (err) { toast("Couldn't cancel that: " + err.message); }
  };
}

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
