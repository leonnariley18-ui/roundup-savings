/* Ledger — Statements
 *
 * Calibration and close-date logging. Reads the same prediction function Which
 * card does, so the two screens can never disagree about when a card closes.
 *
 * Nothing here is seeded. Every date in this tab is one that was observed and
 * typed in, which is what makes the whole thing trustworthy — and what makes a
 * mistyped entry recoverable, since removing it re-derives everything.
 */

import { today, key, fmtD, daysBetween } from '../dates.js';
import { analyse, calc, calibration } from '../statements.js';
import { NEEDED } from '../config.js';
import { loadCards, logClose, removeClose, setApr } from '../data.js';
import { dateField, onDateChange, dateValue } from '../ui/datepicker.js';
import { toast } from '../ui/toast.js';
import { openHelp } from '../help.js';

let state = { data: null };
let host = null;
let onChanged = () => {};

/* Which card holds the same rows, so it is told to refetch after any change. */
export function setChangeHandler(fn) { onChanged = fn; }

export async function mount(el) {
  host = el;
  host.innerHTML = '<div class="soon"><div class="t">Loading…</div></div>';
  try {
    state.data = await loadCards();
    render();
  } catch (err) {
    host.innerHTML = `<div class="soon"><div class="t">Couldn't load your cards</div>
      <div class="b">${err.message}</div></div>`;
  }
}

async function reload() {
  state.data = await loadCards();
  render();
  onChanged();
}

function render() {
  const { cards, closesByCard, closeRows } = state.data;
  const st = calibration(cards, closesByCard);
  const pct = st.total ? Math.round(st.logged / st.total * 100) : 0;

  const next = st.per
    .filter(x => !x.a.confirmed)
    .map(x => ({ name: x.card.name, d: calc(x.card, closesByCard[x.card.id] || [], today()).daysToClose }))
    .sort((a, b) => a.d - b.d)[0];

  host.innerHTML = `
    <div class="helprow"><button class="qbtn" data-help="stmt" aria-label="Why these dates need confirming">?</button></div>

    <div class="calib ${st.done ? 'done' : ''}">
      <div class="cbh">
        <span class="t">${st.done ? 'Which card is calibrated' : 'Calibrating — recommendations are provisional'}</span>
        <span class="pill">${st.confirmed} of ${cards.length} cards confirmed</span>
      </div>
      <div class="ctext">${st.done
        ? `Every card has <b>${NEEDED} logged statement closes</b> and a known APR. Float figures are based on observed behaviour rather than assumption.`
        : `Which card is fully usable and is treating the dates you entered as truth. But those came off single statements, and most issuers close on a rolling cycle rather than a fixed date — so a float figure can be off by several days. Log each real closing date as statements arrive. <b>${NEEDED} consistent closes per card</b> confirms it, which takes about three months.`}</div>
      <div class="cbar"><i style="width:${pct}%"></i></div>
      <div class="cmeta">
        <span>${st.logged} of ${st.total} statements logged</span>
        <span>${next ? 'Next expected: ' + next.name + (next.d <= 3 ? ' · in ' + next.d + ' day' + (next.d === 1 ? '' : 's') : '') : 'all confirmed'}</span>
      </div>
      ${st.gaps.length ? `<div class="gaps">${st.gaps.map(g => `
        <div class="gap"><span class="dot"></span><b>${g.card.name}</b> — ${g.txt}
          ${g.t === 'apr' ? `<input class="aprin" placeholder="27.49" aria-label="APR for ${g.card.name}"
             data-aprfor="${g.card.id}"><button class="vbtn" data-saveapr="${g.card.id}">Save</button>` : ''}
        </div>`).join('')}</div>` : ''}
    </div>

    <div class="panel">${verifyHTML(st)}</div>

    <h2 class="sec">Everything you've logged</h2>
    ${obsLogHTML(closeRows)}`;

  wire();
}

/* One row per card, least confident first, so the cards that need attention
 * are the ones you see. Per-card confidence rather than one aggregate bar —
 * individual cards flip to confirmed instead of a single number crawling for
 * three months. */
function verifyHTML(st) {
  const rank = { no: 0, est: 1, mixed: 1.5, likely: 2, ok: 3 };
  const sorted = [...st.per].sort((a, b) =>
    rank[a.a.conf] - rank[b.a.conf] ||
    calc(a.card, state.data.closesByCard[a.card.id] || [], today()).daysToClose -
    calc(b.card, state.data.closesByCard[b.card.id] || [], today()).daysToClose);

  return sorted.map(({ card, a }) => {
    const t = calc(card, state.data.closesByCard[card.id] || [], today());
    const soon = t.daysToClose <= 3;
    return `<div class="vrow">
      <div class="vn">
        <div class="n">${card.name}</div>
        <div class="s">Expecting close ${t.certain ? '' : '~'}${fmtD(t.close)}${
          soon ? ` · <span class="due-soon">in ${t.daysToClose} day${t.daysToClose === 1 ? '' : 's'}</span>` : ''}</div>
        ${a.obs.length ? `<div class="obs">${a.obs.slice(0, 4).map(d => `<i>${fmtD(d)}</i>`).join('')}</div>` : ''}
        <div class="pattern ${a.kind === 'mixed' ? 'bad' : a.pattern ? '' : 'warn'}">${
          a.pattern || 'Log a closing date to start finding the pattern'}</div>
      </div>
      <span class="conf ${a.conf}">${a.label}</span>
      ${dateField('vin-' + card.id, { value: key(today()), label: 'Actual closing date for ' + card.name })}
      <button class="vbtn" data-log="${card.id}">Log it</button>
    </div>`;
  }).join('');
}

/* Without this the tab logs into a void. Removing an entry re-derives the
 * pattern, so a mistyped date is recoverable rather than permanent. */
function obsLogHTML(rows) {
  if (!rows.length) {
    return `<div class="panel lempty">
      Nothing logged yet.<br>Log a closing date above and it lands here — this list is the only
      thing the predictions are built from.</div>`;
  }
  return `<div class="panel" style="padding:3px 2px">
    ${rows.map(r => {
      const card = state.data.cards.find(c => c.id === r.card_id);
      return `<div class="lrow">
        <span class="when">${fmtD(new Date(r.closed_on + 'T00:00:00'))}</span>
        <span class="card">${card ? card.name : 'Unknown card'}<span class="sub"> · closed ···${card ? card.last4 : '????'}</span></span>
        <button class="x" data-unobs="${r.id}" aria-label="Remove this observation" title="Remove">×</button>
      </div>`;
    }).join('')}</div>`;
}

function wire() {
  host.querySelectorAll('[data-log]').forEach(btn => {
    const cardId = btn.dataset.log;
    onDateChange('vin-' + cardId, () => {});
    btn.onclick = async () => {
      const value = dateValue('vin-' + cardId);
      if (!value) { toast('Pick the date the statement actually closed'); return; }
      btn.disabled = true;
      try {
        await logClose(cardId, value);
        const card = state.data.cards.find(c => c.id === cardId);
        const a = analyse([...(state.data.closesByCard[cardId] || []), value]);
        await reload();
        toast(card.name + ' — ' + (a.confirmed ? 'confirmed' : `logged, ${a.left} more to confirm`));
      } catch (err) {
        btn.disabled = false;
        toast(err.message.includes('duplicate')
          ? 'That date is already logged for this card'
          : "Couldn't log that: " + err.message);
      }
    };
  });

  host.querySelectorAll('[data-unobs]').forEach(b => b.onclick = async () => {
    try {
      await removeClose(b.dataset.unobs);
      await reload();
      toast('Removed — predictions re-derived');
    } catch (err) { toast("Couldn't remove that: " + err.message); }
  });

  host.querySelectorAll('[data-saveapr]').forEach(b => b.onclick = async () => {
    const input = host.querySelector(`[data-aprfor="${b.dataset.saveapr}"]`);
    const v = parseFloat(input && input.value);
    if (!isFinite(v) || v <= 0 || v > 60) { toast('Enter the purchase APR, e.g. 27.49'); return; }
    try {
      await setApr(b.dataset.saveapr, v);
      const card = state.data.cards.find(c => c.id === b.dataset.saveapr);
      await reload();
      toast(card.name + ' — APR set to ' + v.toFixed(2) + '%');
    } catch (err) { toast("Couldn't save that: " + err.message); }
  });

  const help = host.querySelector('[data-help]');
  if (help) help.onclick = () => openHelp('stmt');
}
