/* Ledger mobile — Which card. Full date-scrubber + ranked table, same as
 * desktop — explicitly not a cut-down "today only" view, per HANDOVER.md. */

import { today, add, key, fmtD, money, daysBetween } from '../../../../assets/js/dates.js';
import { rankCards } from '../../../../assets/js/ranking.js';
import { logDecision } from '../../../../assets/js/data.js';
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
    </div>`;

  wire(best);
}

function recHTML(best) {
  if (!best) return `<div class="rl">No recommendation</div><div style="font-family:var(--sans);font-size:14px;color:var(--faint);margin-top:8px">Every card is carrying a balance or has no data.</div>`;
  return `<div class="rl">Use this one</div>
    <div class="rname">${esc(best.card.name)}</div>
    <div class="rwhy"><b>${best.text}</b> on ${CATS.find(c => c[0] === category)[1].toLowerCase()} — <b>${best.float} days</b> of float · closes ${fmtD(best.close)}.</div>
    <button class="use-btn" id="wcUse">I used this card</button>`;
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

  const use = host.querySelector('#wcUse');
  if (use) use.onclick = async () => {
    if (!best) return;
    use.disabled = true;
    try {
      const row = await logDecision({
        cardId: best.card.id, category, amount: null, rewardPct: best.pct, rewardAmount: null,
        decidedAt: new Date(refDate).toISOString(),
      });
      state.decisions.unshift(row);
      toast('Logged — you took the pick');
    } catch (err) { toast("Couldn't log that: " + err.message); }
    use.disabled = false;
  };
}

const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
