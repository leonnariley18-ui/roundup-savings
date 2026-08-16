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
import * as roundup from './screens/roundup.js';



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

  /* The four built screens. They read overlapping rows — cards, statement
     closes, paybacks — so a change in one has to reach the others. Logging a
     close moves every predicted date, and Which card would otherwise keep
     ranking on a prediction Statements has already replaced. */
  if (dbStatus().ok && session) {
    statements.setChangeHandler(() => {
      whichCard.refresh().catch(() => {});
      calendar.reload().catch(() => {});
    });
    /* allSettled, not all. Each screen renders its own error state, so one
       failing load should cost that screen and nothing else — with `all`, a
       single rejected mount escapes to main() and the shell never appears at
       all, turning one broken table into a blank page. */
    const mounted = await Promise.allSettled([
      whichCard.mount(document.getElementById('t-cards')),
      statements.mount(document.getElementById('t-stmt')),
      paybacks.mount(document.getElementById('t-pb')),
      calendar.mount(document.getElementById('t-cal')),
      loan.load(),
      roundup.mount(document.getElementById('t-ru')),
    ]);
    mounted.filter(m => m.status === 'rejected')
           .forEach(m => console.warn('screen failed to load:', m.reason));
    roundup.setChangeHandler(() => calendar.reload().catch(() => {}));
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
