/* Ledger — Which card
 *
 * A pre-purchase decision tool, not a record system. It answers one question —
 * which card should this go on — and the only thing it records is that you took
 * the answer.
 *
 * All ranking derives from the scrubbed date rather than from now, so float
 * shrinks and grows as close dates pass and the answer changes with it.
 */

import { today, add, key, pd, fmtD, fmtDW, money, DW, dayIndex, daysBetween } from '../dates.js';
import { rankCards } from '../ranking.js';
import { loadCards, loadDecisions, logDecision, removeDecision, setCapBlown,
         setChoiceCategory, callFunction } from '../data.js';
import { dateField, onDateChange, setDate } from '../ui/datepicker.js';
import { selectField, onSelectChange } from '../ui/select.js';
import { toast } from '../ui/toast.js';
import { openHelp } from '../help.js';

const CATS = [
  ['dining', 'Dining'], ['grocery', 'Groceries'], ['gas', 'Gas'], ['transit', 'Transit'],
  ['online', 'Online'], ['travel', 'Travel'], ['streaming', 'Streaming'],
  ['phone', 'Phone plan'], ['ae', 'American Eagle'], ['other', 'Everything else'],
];

const QUICK = [['Today', 0], ['+3 days', 3], ['+1 week', 7], ['+2 weeks', 14]];

const BOFA_CHOICES = [
  ['online', 'Online shopping'], ['dining', 'Dining'], ['gas', 'Gas & EV charging'],
  ['travel', 'Travel'], ['drug', 'Drug stores'], ['home', 'Home improvement'],
];

let state = { refDate: today(), category: 'dining', amount: 0, data: null, decisions: [] };
let host = null;

export async function mount(el) {
  host = el;
  host.innerHTML = '<div class="soon"><div class="t">Loading…</div></div>';
  try {
    const [data, decisions] = await Promise.all([loadCards(), loadDecisions()]);
    state.data = data;
    state.decisions = decisions;
    render();
  } catch (err) {
    host.innerHTML = `<div class="soon"><div class="t">Couldn't load your cards</div>
      <div class="b">${err.message}</div></div>`;
  }
}

/* Refetches, for when Statements has changed the observations underneath. */
export async function refresh() {
  if (!host) return;
  state.data = await loadCards();
  render();
}

const qEnd = d => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0);

function render() {
  if (!state.data) return;
  const { cards, rewardsByCard, choiceByCard, closesByCard } = state.data;
  const on = state.refDate;
  const offset = daysBetween(today(), on);

  const { rows, best } = rankCards({
    cards, rewardsByCard, choiceByCard, closesByCard,
    category: state.category, amount: state.amount, on,
  });

  host.innerHTML = `
    <div class="helprow"><button class="qbtn" data-help="cards" aria-label="How this ranks">?</button></div>
    <div class="cardtop">
      <div class="askrow">
        <div class="askf">
          <span class="label">Buying when?</span>
          ${dateField('when', { value: key(on), min: key(today()), label: 'Purchase date' })}
          <div class="dquick">${QUICK.map(([l, n]) =>
            `<button data-off="${n}" aria-pressed="${offset === n}">${l}</button>`).join('')}</div>
        </div>
        <div class="askf">
          <label class="label" for="amt">How much? <span style="color:var(--faint)">optional</span></label>
          <div class="amtin"><span>$</span><input id="amt" type="number" min="0" step="1"
            placeholder="—" aria-label="Purchase amount" value="${state.amount || ''}"></div>
        </div>
        <div class="askf grow">
          <span class="label">On what?</span>
          <div class="selector" id="sel" role="group" aria-label="Purchase category">
            ${CATS.map(([k, l]) => `<button aria-pressed="${k === state.category}" data-c="${k}">${l}</button>`).join('')}
          </div>
        </div>
      </div>
      <div id="pick">${pickHTML(best, rows.filter(r => !r.carrying), cards)}</div>
    </div>

    <h2 class="sec">All cards</h2>
    <div class="panel" style="padding:13px 4px 3px;overflow-x:auto">
      <table class="ctbl">
        <thead><tr><th>Card</th><th>${CATS.find(c => c[0] === state.category)[1]}</th>
          <th>Back</th><th>Float</th><th>Statement</th><th>Balance</th><th>APR</th></tr></thead>
        <tbody>${rows.map(r => rowHTML(r, best)).join('')}</tbody>
      </table>
    </div>

    <div class="syncrow">
      <span>${syncedLine(cards)}</span>
      <button class="tbtn" id="syncBal">Sync balances</button>
    </div>

    <div class="panel" style="margin-top:13px" id="bofaPanel">${bofaHTML()}</div>

    <h2 class="sec">Are you actually using this?</h2>
    <div id="ledger">${logHTML()}</div>`;

  wire();
}

/* ---------------------------------------------------------------- the pick */

function pickHTML(best, eligible, cards) {
  if (!best) {
    return `<div class="panel">Every card is carrying a balance, so none has a grace period right now.</div>`;
  }

  const offset = daysBetween(today(), state.refDate);
  const asOf = offset === 0 ? '' :
    `<div class="asof">If you buy on ${DW[dayIndex(state.refDate)]} ${fmtD(state.refDate)}
     &middot; ${offset} day${offset > 1 ? 's' : ''} from today</div>`;

  const flag = best.card.flag_text
    ? `<div class="cardflag ${best.card.flag_kind || 'good'}">${best.card.flag_text}</div>` : '';

  return `${asOf}
    <div class="pick">
      <div class="label">Use this one</div>
      <div class="hd">
        <div class="nm">${best.card.name}</div>
        <span class="chip auto">${best.text}${best.chosen ? ' · your pick' : ''}</span>
        ${state.amount ? `<span class="back-amt">${money(best.back)} back</span>` : ''}
        ${best.capHit ? '<span class="chip est">cap applies</span>' : ''}
        ${best.certain ? '' : '<span class="prov">Provisional</span>'}
      </div>
      <div class="why">${reason(best, eligible, cards)}</div>
      ${flag}
      <div class="logged">
        <button class="go" id="logUse">I used this card</button>
        <span class="hint">Records that you took the pick &middot; nothing else happens</span>
      </div>
    </div>`;
}

/* Explains the trade in dollars and days, not just a winner. */
function reason(best, eligible, cards) {
  const catLabel = CATS.find(c => c[0] === state.category)[1].toLowerCase();

  let s = `Closes in <b>${best.daysToClose} days</b>, so this wouldn't be due until ` +
          `<b>${fmtD(best.due)} — ${best.float} days of float</b>.`;
  if (best.card.notes) s += ` ${best.card.notes}`;
  if (best.chosen) s += ` <b>${catLabel}</b> is your chosen 3% category this month.`;
  if (best.capHit) s += ` <span style="color:var(--warn)">Part of this purchase falls past the quarterly cap, so the effective rate is ${best.pct.toFixed(2)}%.</span>`;
  if (!best.certain) s += ` <span style="color:var(--warn)">Its closing date isn't confirmed yet, so treat that float as approximate.</span>`;

  const next = eligible[1];
  if (next) {
    const gap = +(next.pct - best.pct).toFixed(2);
    if (state.amount && Math.abs(next.back - best.back) >= 0.01) {
      const diff = Math.abs(next.back - best.back).toFixed(2);
      if (next.back > best.back) {
        s += `<br><br><em>${next.card.name}</em> would return ${money(next.back)} against ${money(best.back)} — $${diff} more — ` +
             `but it closes in ${next.daysToClose} days, landing that bill ${fmtD(next.due)}. ` +
             `That's ${best.float - next.float} days less float for $${diff}.`;
      } else {
        s += `<br><br>Next best is <em>${next.card.name}</em> at ${money(next.back)}, ${next.float} days of float.`;
      }
    } else if (gap > 0) {
      s += `<br><br><em>${next.card.name}</em> pays ${next.text} on ${catLabel} but closes in ${next.daysToClose} days — ` +
           `${best.float - next.float} days less float.`;
    } else {
      s += `<br><br>Next best is <em>${next.card.name}</em> at ${next.text}, ${next.float} days of float.`;
    }
  }

  const carrying = cards.filter(c => Number(c.current_balance) > 0);
  if (carrying.length) {
    s += `<br><br>${carrying.map(c => c.name).join(' and ')} ${carrying.length > 1 ? 'are' : 'is'} carrying a balance, ` +
         `so ${carrying.length > 1 ? 'they have' : 'it has'} no grace period — anything new starts accruing immediately.`;
  }
  return s;
}

/* ---------------------------------------------------------------- the table */

function rowHTML(r, best) {
  const isBest = best && r.card.id === best.card.id;
  const tilde = r.certain ? '' : '~';
  const width = Math.max(3, Math.min(100, r.float / 58 * 100));
  const barClass = r.float < 14 ? 'low' : r.float < 30 ? 'mid' : '';
  const limit = Number(r.card.credit_limit) || 0;

  return `<tr class="${isBest ? 'best' : ''}${r.carrying ? ' out' : ''}">
    <td>
      <div class="cn">${r.card.name}</div>
      <div class="cs">···${r.card.last4}${r.carrying ? ' · carrying a balance, no grace period' : ''}</div>
      ${r.card.flag_text && !isBest ? `<div class="cs flagline ${r.card.flag_kind || 'good'}">${r.card.flag_text}</div>` : ''}
    </td>
    <td>
      <b style="color:${isBest ? 'var(--accent)' : 'var(--text)'}">${r.text}</b>
      ${r.chosen ? '<div class="cs">your chosen category</div>' : ''}
      ${r.row && r.row.label_note ? `<div class="cs">${r.row.label_note}</div>` : ''}
      ${r.offersOnly ? '<div class="cs">only pays via an activated offer</div>' : ''}
      ${r.capHit ? '<div class="cs" style="color:var(--warn)">cap reached — part at the base rate</div>' : ''}
    </td>
    <td>${state.amount
      ? `<div class="mono" style="font-weight:600;color:${isBest ? 'var(--accent)' : 'var(--text)'}">${money(r.back)}</div>`
      : '<span class="cs">—</span>'}</td>
    <td><div class="mono">${tilde}${r.float} days</div>
      <div class="fbar"><i class="${barClass}" style="width:${width}%"></i></div></td>
    <td class="mono">${tilde}Closes ${fmtD(r.close)}
      <div class="cs">Due ${fmtD(r.due)}</div>
      ${r.why ? `<div class="cs" style="color:var(--warn)">${r.why}</div>` : ''}</td>
    <td class="mono">${money(r.card.current_balance)}
      <div class="cs">${r.util.toFixed(0)}% of $${limit.toLocaleString()}</div></td>
    <td class="mono">${r.card.apr == null
      ? '<span style="color:var(--warn)">not set</span>'
      : Number(r.card.apr).toFixed(2) + '%'}</td>
  </tr>`;
}

/* ---------------------------------------------------------------- BofA */

/* A balance is an estimate with an age. Lunch Money background-syncs a single
 * figure through Plaid, so anywhere one appears it says when it last moved —
 * a day or two of lag is irrelevant to a rule whose threshold is "any balance
 * at all", but pretending it is live would not be. */
function syncedLine(cards) {
  const stamps = cards.map(c => c.balance_synced_at).filter(Boolean).sort();
  if (!stamps.length) return 'Balances have never been synced — they are the figures from setup.';
  const when = new Date(stamps[stamps.length - 1]);
  return `Balances synced ${when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · treat as an estimate`;
}

function bofaCard() {
  return state.data.cards.find(c => c.cap_limit != null) || null;
}

function bofaHTML() {
  const c = bofaCard();
  if (!c) return '';
  const chosen = state.data.choiceByCard[c.id] || 'online';
  const blown = !!c.cap_blown;
  const end = qEnd(today());

  return `
    <div class="label" style="margin-bottom:11px">Your BofA card</div>
    <div class="plain">
      BofA lets you <b>pick one category each month</b> to earn 3% back. Groceries always earn 2%.
      Everything else earns 1%. Those better rates stop after
      <b>$${Number(c.cap_limit).toLocaleString()} of spending per quarter</b> — groceries and your
      3% category share that one budget — and reset
      <b>${end.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</b>.
    </div>
    <div class="pickrow">
      <span class="pl">Right now you're earning 3% on</span>
      ${selectField('bofaChoice', BOFA_CHOICES, chosen, 'Your 3% category')}
      <span class="pl">— change it in the BofA app if that's wrong.</span>
    </div>
    <div class="caprow">
      <label class="capcheck"><input type="checkbox" id="bofaBlown" ${blown ? 'checked' : ''}>
        <span>I've already used up the $${Number(c.cap_limit).toLocaleString()} this quarter</span></label>
    </div>
    <div class="capnote ${blown ? 'bad' : ''}">
      ${blown
        ? 'Both categories are paying 1% until the quarter resets, so BofA is ranked at its base rate.'
        : "Leave this unticked unless the BofA app says you've hit it. Tick it and BofA drops to 1% everywhere in the ranking."}
    </div>`;
}

/* ---------------------------------------------------------------- the log */

function logHTML() {
  if (!state.decisions.length) {
    return `<div class="panel lempty">
      Nothing logged yet.<br>
      Hit <b style="color:var(--muted)">I used this card</b> when you take the recommendation.<br>
      That's all this is — a record that the tab is earning its place.</div>`;
  }

  const byCard = {};
  const named = state.decisions.map(d => {
    const card = state.data.cards.find(c => c.id === d.card_id);
    const name = card ? card.name : 'A card you no longer have';
    byCard[name] = (byCard[name] || 0) + 1;
    return { ...d, name };
  });
  const top = Object.entries(byCard).sort((a, b) => b[1] - a[1])[0];

  return `
    <div class="lstats" style="grid-template-columns:repeat(2,1fr)">
      <div class="lstat"><div class="k g">${state.decisions.length}</div>
        <div class="v">times you took the recommendation</div></div>
      <div class="lstat"><div class="k">${fmtD(new Date(state.decisions[0].decided_at))}</div>
        <div class="v">most recent</div></div>
    </div>
    <div class="panel" style="padding:3px 2px;margin-bottom:12px">
      ${named.slice(0, 12).map(d => `<div class="lrow">
        <span class="when">${fmtD(new Date(d.decided_at))}</span>
        <span class="card">${d.name}<span class="sub"> · ${(CATS.find(c => c[0] === d.category) || ['', '—'])[1].toLowerCase()}</span></span>
        ${d.amount ? `<span class="amt">${money(d.amount)}</span>` : ''}
        <span class="back">&#10003;</span>
        <button class="x" data-unlog="${d.id}" aria-label="Remove this entry" title="Remove">×</button>
      </div>`).join('')}
    </div>
    ${top ? `<div style="font-size:12px;color:var(--faint)">Most reached for:
      <b style="color:var(--muted)">${top[0]}</b>, ${top[1]} time${top[1] > 1 ? 's' : ''}.${
      state.decisions.length > 12 ? ' Showing the last 12.' : ''}</div>` : ''}`;
}

/* ---------------------------------------------------------------- wiring */

function wire() {
  host.querySelectorAll('.dquick button').forEach(b => {
    b.onclick = () => { state.refDate = add(today(), Number(b.dataset.off)); render(); };
  });

  onDateChange('when', k => { state.refDate = pd(k); render(); });

  host.querySelectorAll('#sel button').forEach(b => {
    b.onclick = () => { state.category = b.dataset.c; render(); };
  });

  const amt = host.querySelector('#amt');
  if (amt) {
    /* Re-render on input but keep focus and caret, since the whole screen is
       rebuilt on every keystroke. */
    amt.oninput = () => {
      state.amount = Math.max(0, parseFloat(amt.value) || 0);
      const pos = amt.selectionStart;
      render();
      const again = host.querySelector('#amt');
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    };
  }

  onSelectChange('bofaChoice', async (value, label) => {
    const c = bofaCard();
    if (!c) return;
    try {
      await setChoiceCategory(c.id, value);
      state.data.choiceByCard[c.id] = value;
      render();
      toast('Now earning 3% on ' + label.toLowerCase());
    } catch (err) { toast("Couldn't save that: " + err.message); }
  });

  const blown = host.querySelector('#bofaBlown');
  if (blown) blown.onchange = async () => {
    const c = bofaCard();
    try {
      await setCapBlown(c.id, blown.checked);
      c.cap_blown = blown.checked;
      render();
    } catch (err) { toast("Couldn't save that: " + err.message); }
  };

  const use = host.querySelector('#logUse');
  if (use) use.onclick = async () => {
    const { cards, rewardsByCard, choiceByCard, closesByCard } = state.data;
    const { best } = rankCards({ cards, rewardsByCard, choiceByCard, closesByCard,
      category: state.category, amount: state.amount, on: state.refDate });
    if (!best) return;
    use.disabled = true;
    try {
      const row = await logDecision({
        cardId: best.card.id, category: state.category,
        amount: state.amount || null, rewardPct: best.pct,
        rewardAmount: state.amount ? best.back : null,
        /* The scrubbed date, not now — this records the day being decided. */
        decidedAt: new Date(state.refDate).toISOString(),
      });
      state.decisions.unshift(row);
      render();
      toast('Logged — you took the pick');
    } catch (err) {
      use.disabled = false;
      toast("Couldn't log that: " + err.message);
    }
  };

  host.querySelectorAll('[data-unlog]').forEach(b => b.onclick = async () => {
    try {
      await removeDecision(b.dataset.unlog);
      state.decisions = state.decisions.filter(d => d.id !== b.dataset.unlog);
      render();
      toast('Removed');
    } catch (err) { toast("Couldn't remove that: " + err.message); }
  });

  const sync = host.querySelector('#syncBal');
  if (sync) sync.onclick = async () => {
    sync.disabled = true; sync.textContent = 'Syncing…';
    try {
      const out = await callFunction('sync-card-balances');
      state.data = await loadCards();
      render();
      toast(out.unmatched && out.unmatched.length
        ? `Synced ${out.updated.length} · no match for ${out.unmatched.join(', ')}`
        : `Synced ${out.updated.length} card${out.updated.length === 1 ? '' : 's'}`);
    } catch (err) {
      sync.disabled = false; sync.textContent = 'Sync balances';
      toast("Couldn't sync: " + err.message);
    }
  };

  const help = host.querySelector('[data-help]');
  if (help) help.onclick = () => openHelp('cards');
}
