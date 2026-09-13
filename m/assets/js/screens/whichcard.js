/* Ledger mobile — Which card. Full date-scrubber + ranked table, same as
 * desktop — explicitly not a cut-down "today only" view, per HANDOVER.md. */

import { today, add, key, fmtD, money, daysBetween } from '../../../../assets/js/dates.js';
import { rankCards } from '../../../../assets/js/ranking.js';
import { logDecision, createPayback, linkDecisionToPayback } from '../../../../assets/js/data.js';
import { state } from '../state.js';
import { toast } from '../toast.js';

const CATS = [
  ['dining', 'Dining'], ['online', 'Online'], ['gas', 'Gas'],
  ['travel', 'Travel'], ['transit', 'Transit'], ['other', 'Everything else'],
];
const QUICK = [['Today', 0], ['+3 days', 3], ['+1 week', 7], ['+2 weeks', 14]];

let host = null;
let controlsOpen = false;
let refDate = today();
let category = 'dining';
let frontIt = false, frontDesc = '', frontAmt = '';

export async function mount(el) {
  host = el;
  render();
}

export function render() {
  if (!host) return;
  const offset = daysBetween(today(), refDate);
  const { rows, best } = rankCards({
    cards: state.cards, rewardsByCard: state.rewardsByCard, choiceByCard: state.choiceByCard,
    closesByCard: state.closesByCard, category, amount: 0, on: refDate,
  });
  const offLabel = (QUICK.find(([, n]) => n === offset) || [])[0] || fmtD(refDate);
  const catLabel = CATS.find(c => c[0] === category)[1];

  host.innerHTML = `
    <div class="mtopbar" style="padding-bottom:10px"><div class="mtitle">Which card?</div></div>
    <button class="wc-collapse-bar" id="wcToggle">
      <span>${catLabel} · ${offLabel}</span>
      <span id="wcIco" style="font-size:14px;transition:transform .2s;transform:${controlsOpen ? 'rotate(180deg)' : ''}">▾</span>
    </button>
    <div class="wc-controls${controlsOpen ? ' open' : ''}">
      <div class="lbl" style="font-family:var(--mono);font-size:9px;color:var(--faint);letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px">Buying when?</div>
      <div class="scrub-row">
        ${QUICK.map(([l, n]) => `<button class="scrub-chip${offset === n ? ' on' : ''}" data-off="${n}">${l}</button>`).join('')}
      </div>
      <div class="lbl" style="font-family:var(--mono);font-size:9px;color:var(--faint);letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px">Category</div>
      <div class="cat-grid">
        ${CATS.map(([k, l]) => `<button class="cat-btn${category === k ? ' on' : ''}" data-cat="${k}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="wc-body">
      <div class="wc-rec">${recHTML(best)}</div>
      <table class="wc-tbl">
        <thead><tr><th>Card</th><th>Rate</th><th>Float</th></tr></thead>
        <tbody>${rows.map(r => rowHTML(r, best)).join('')}</tbody>
      </table>
    </div>
    <div class="bsect-lbl" style="border-top:2px solid var(--soft);padding-top:14px;margin-top:14px">Are you actually using this?</div>
    ${logHTML()}`;

  wire(best);
}

function recHTML(best) {
  if (!best) return `<div class="rl">No recommendation</div><div style="font-family:var(--sans);font-size:14px;color:var(--faint);margin-top:8px">Every card is carrying a balance or has no data.</div>`;
  return `<div class="rl">Use this one</div>
    <div class="rname">${esc(best.card.name)}</div>
    <div class="rwhy"><b>${best.text}</b> on ${CATS.find(c => c[0] === category)[1].toLowerCase()} — <b>${best.float} days</b> of float · closes ${fmtD(best.close)}.</div>
    <button class="use-btn" id="wcUse">I used this card</button>
    <label class="capcheck" style="margin-top:12px;font-family:var(--sans);font-size:13px;color:var(--muted);display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="frontIt" ${frontIt ? 'checked' : ''}>
      <span>I'll need to pay this back — also log it as a payback</span>
    </label>
    ${frontIt ? `<div class="frow" style="margin-top:10px"><div class="lbl">What was it?</div>
        <input id="frontDesc" type="text" autocomplete="off" value="${esc(frontDesc)}" placeholder="Concert tickets, a group dinner…"></div>
      <div class="frow" style="margin-top:10px"><div class="lbl">How much?</div>
        <input id="frontAmt" type="number" inputmode="decimal" min="0" step="1" value="${esc(frontAmt)}"></div>` : ''}`;
}

/* Same "are you actually using this" log desktop shows, so the feature has
 * evidence behind it on mobile too — including which entries turned into a
 * logged payback. */
function logHTML() {
  const decisions = state.decisions || [];
  if (!decisions.length) {
    return `<div class="msoon"><div class="t">Nothing logged yet</div>
      <div class="b">Hit "I used this card" when you take the recommendation.</div></div>`;
  }
  return `<div class="bill-summ" style="border-bottom:0;padding-top:8px">
    <div class="bill-amt">${decisions.length}</div>
    <div class="bill-sub">times you took the recommendation</div>
  </div>
  ${decisions.slice(0, 12).map(d => {
    const card = state.cards.find(c => c.id === d.card_id);
    return `<div class="bill-row">
      <div style="width:3px;height:36px;flex-shrink:0;background:${d.payback_id ? 'var(--accent)' : 'var(--soft)'}"></div>
      <div class="binfo">
        <div class="nm">${card ? esc(card.name) : 'A card you no longer have'}</div>
        <div class="bsub">${fmtD(new Date(d.decided_at))} · ${(CATS.find(c => c[0] === d.category) || ['', '—'])[1].toLowerCase()}${d.payback_id ? ' · linked to a payback' : ''}</div>
      </div>
      ${d.amount ? `<div class="bamt">${money(d.amount)}</div>` : ''}
    </div>`;
  }).join('')}
  ${decisions.length > 12 ? `<div style="padding:8px 20px;font-family:var(--sans);font-size:12px;color:var(--faint)">Showing the last 12.</div>` : ''}`;
}

function rowHTML(r, best) {
  const isBest = best && r.card.id === best.card.id;
  return `<tr class="${isBest ? 'best' : ''}${r.carrying ? ' out' : ''}">
    <td><span class="cn">${esc(r.card.name)}</span>${r.carrying ? '<span class="cs">carrying a balance</span>' : ''}</td>
    <td style="color:${isBest ? 'var(--accent)' : 'var(--muted)'}">${r.carrying ? '—' : r.text}</td>
    <td style="color:${!r.carrying && r.float < 5 ? 'var(--warn)' : 'var(--muted)'}">${r.carrying ? '—' : r.float + 'd'}</td>
  </tr>`;
}

function wire(best) {
  const toggle = host.querySelector('#wcToggle');
  if (toggle) toggle.onclick = () => { controlsOpen = !controlsOpen; render(); };

  host.querySelectorAll('[data-off]').forEach(b => b.onclick = () => {
    refDate = add(today(), Number(b.dataset.off));
    render();
  });
  host.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
    category = b.dataset.cat;
    render();
  });

  const front = host.querySelector('#frontIt');
  if (front) front.onchange = () => { frontIt = front.checked; render(); };
  const frontDescEl = host.querySelector('#frontDesc');
  if (frontDescEl) frontDescEl.oninput = () => { frontDesc = frontDescEl.value; };
  const frontAmtEl = host.querySelector('#frontAmt');
  if (frontAmtEl) frontAmtEl.oninput = () => { frontAmt = frontAmtEl.value; };

  const use = host.querySelector('#wcUse');
  if (use) use.onclick = async () => {
    if (!best) return;

    const description = frontDesc.trim();
    const amount = parseFloat(frontAmt);
    if (frontIt && !description) { toast('Give the payback a name first'); return; }
    if (frontIt && !(isFinite(amount) && amount > 0)) { toast('Enter an amount to log it as a payback'); return; }

    use.disabled = true;
    try {
      const row = await logDecision({
        cardId: best.card.id, category, amount: null, rewardPct: best.pct, rewardAmount: null,
        decidedAt: new Date(refDate).toISOString(),
      });
      state.decisions.unshift(row);

      if (frontIt) {
        const pb = await createPayback({
          description, amount, cardId: best.card.id,
          incurredOn: key(refDate), intendedOn: key(add(refDate, 7)),
        });
        await linkDecisionToPayback(row.id, pb.id);
        frontIt = false; frontDesc = ''; frontAmt = '';
        toast('Logged — you took the pick, and logged a payback for it');
      } else {
        toast('Logged — you took the pick');
      }
      render();
    } catch (err) { toast("Couldn't log that: " + err.message); }
    use.disabled = false;
  };
}

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
