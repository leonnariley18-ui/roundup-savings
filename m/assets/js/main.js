/* Ledger mobile — bootstrap.
 *
 * Same db.js/auth.js desktop uses, unchanged — the two frontends share one
 * Supabase client config and one localStorage session slot ('ledger-auth-token'),
 * so signing in on desktop leaves mobile already authenticated.
 */

import { initDb, dbStatus } from '../../../assets/js/db.js';
import { currentSession, showGate } from '../../../assets/js/auth.js';
import { registerScreen, initShell } from './shell.js';
import { reload } from './state.js';

import * as week from './screens/week.js';
import * as calendar from './screens/calendar.js';
import * as bills from './screens/bills.js';
import * as paybacks from './screens/paybacks.js';
import * as whichcard from './screens/whichcard.js';

function paintSyncDot() {
  const { ok, reason } = dbStatus();
  const dot = document.getElementById('mSyncDot');
  if (!dot) return;
  dot.classList.toggle('ok', ok);
  dot.title = ok ? 'Connected' : reason === 'unconfigured' ? 'Not connected — unconfigured' : 'Not connected — unreachable';
}

async function main() {
  await initDb();
  paintSyncDot();

  let session = await currentSession();
  if (dbStatus().ok && !session) session = await showGate();

  document.getElementById('gate').hidden = true;
  document.getElementById('appWrap').hidden = false;

  if (!dbStatus().ok || !session) return;

  await reload();

  registerScreen('week', week);
  registerScreen('cal', calendar);
  registerScreen('bills', bills);
  registerScreen('pb', paybacks);
  registerScreen('wc', whichcard);

  await initShell();
}

main().catch(err => console.error('mobile bootstrap failed:', err));

/* Registered mainly so Chrome/Android treat this as an installable PWA —
 * see sw.js for what it actually caches (the static shell only). */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('service worker not registered:', err.message));
  });
}
