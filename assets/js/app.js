/* Ledger — bootstrap
 *
 * Foundation phase. The shell, auth and the shared components are real; the six
 * screens are not built yet and say so, each naming its place in the build
 * order rather than showing a blank panel or invented data.
 */

import { initDb, dbStatus } from './db.js';
import { currentSession, showGate, signOut } from './auth.js';
import { initShell, setLoanRenderer } from './shell.js';

/* Loaded for their global click handlers, which is what makes every field
   rendered anywhere in the app live without per-screen wiring. */
import './ui/datepicker.js';
import './ui/select.js';
import './help.js';

import * as whichCard from './screens/whichcard.js';
import * as statements from './screens/statements.js';
import * as paybacks from './screens/paybacks.js';
import * as calendar from './screens/calendar.js';
import * as loan from './screens/loan.js';

const PLACEHOLDERS = {
  'ru': {
    t: 'Round-up',
    b: `Two date pickers, category chips, and a total. Depends on the Lunch Money
        proxy, so it comes late. "I moved the money" will write a date and nothing
        else — the amount lives in your bank, not here.`,
    step: 'step 7',
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

  /* The four built screens. They read overlapping rows — cards, statement
     closes, paybacks — so a change in one has to reach the others. Logging a
     close moves every predicted date, and Which card would otherwise keep
     ranking on a prediction Statements has already replaced. */
  if (dbStatus().ok && session) {
    statements.setChangeHandler(() => {
      whichCard.refresh().catch(() => {});
      calendar.reload().catch(() => {});
    });
    await Promise.all([
      whichCard.mount(document.getElementById('t-cards')),
      statements.mount(document.getElementById('t-stmt')),
      paybacks.mount(document.getElementById('t-pb')),
      calendar.mount(document.getElementById('t-cal')),
      loan.load(),
    ]);
    /* The loan is a modal with two entry points — the drawer and the week
       view's loan row — so it is registered as a renderer rather than mounted
       into a tab. */
    setLoanRenderer(el => loan.render(el));
    /* Paybacks and Statements both change what the calendar draws, so both
       tell it to refetch rather than letting the grid go stale. */
    paybacks.setChangeHandler(() => calendar.reload().catch(() => {}));
  }

  const out = document.getElementById('signOut');
  if (out) {
    out.hidden = !session;
    out.onclick = signOut;
  }

  initShell();   // paints the nav and opens on Calendar
}

main();
