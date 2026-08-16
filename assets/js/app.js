/* Ledger — bootstrap
 *
 * Foundation phase. The shell, auth and the shared components are real; the six
 * screens are not built yet and say so, each naming its place in the build
 * order rather than showing a blank panel or invented data.
 */

import { initDb, dbStatus } from './db.js';
import { currentSession, showGate, signOut } from './auth.js';
import { initShell } from './shell.js';

/* Loaded for their global click handlers, which is what makes every field
   rendered anywhere in the app live without per-screen wiring. */
import './ui/datepicker.js';
import './ui/select.js';
import './help.js';

import * as whichCard from './screens/whichcard.js';
import * as statements from './screens/statements.js';

const PLACEHOLDERS = {
  'cal': {
    t: 'Calendar',
    b: `The landing surface — a Monday-start grid with ISO week numbers, every day
        clickable, and the day modal where notes live. Statement closes, payback
        deadlines and targets populate it before any bill data exists, so it is
        useful well before Lunch Money is connected.`,
    step: 'step 6',
  },
  'ru': {
    t: 'Round-up',
    b: `Two date pickers, category chips, and a total. Depends on the Lunch Money
        proxy, so it comes late. "I moved the money" will write a date and nothing
        else — the amount lives in your bank, not here.`,
    step: 'step 7',
  },
  'pb': {
    t: 'Paybacks',
    b: `Tracks putting something on a card meaning to clear it in days, forgetting,
        and having it quietly become a bill. The countdown runs to statement close,
        not to the payment due date.`,
    step: 'step 4',
  },
};

function renderPlaceholders() {
  for (const [k, p] of Object.entries(PLACEHOLDERS)) {
    const host = document.getElementById('t-' + k);
    if (!host) continue;
    host.innerHTML = `<div class="soon">
        <div class="t">${p.t}</div>
        <div class="b">${p.b}</div>
        <div class="step">Not built yet · build order ${p.step}</div>
      </div>`;
  }
}

function renderConnectionBanner() {
  const el = document.getElementById('conn');
  if (!el) return;
  const { ok, reason } = dbStatus();
  if (ok) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = reason === 'unconfigured'
    ? 'Not connected to Supabase — showing the shell only. ' +
      'Fill in assets/js/config.js to connect. See SETUP.md.'
    : 'Could not reach the Supabase client CDN — showing the shell only. ' +
      'Reload to try again.';
}

async function main() {
  await initDb();

  /* showGate resolves with the session it just established, so this reads the
     same whether the session was restored from storage or signed in for. */
  let session = await currentSession();
  if (dbStatus().ok && !session) session = await showGate();

  document.getElementById('gate').hidden = true;
  document.getElementById('appWrap').hidden = false;

  renderConnectionBanner();
  renderPlaceholders();

  /* The two built screens. They share the same card and statement_closes rows,
     so logging a close in one has to refresh the other — otherwise Which card
     would keep ranking on a prediction that Statements has already replaced. */
  if (dbStatus().ok && session) {
    statements.setChangeHandler(() => whichCard.refresh().catch(() => {}));
    await Promise.all([
      whichCard.mount(document.getElementById('t-cards')),
      statements.mount(document.getElementById('t-stmt')),
    ]);
  }

  const out = document.getElementById('signOut');
  if (out) {
    out.hidden = !session;
    out.onclick = signOut;
  }

  initShell();   // paints the nav and opens on Calendar
}

main();
