/* Ledger — auth
 *
 * One email/password account through Supabase Auth, with RLS scoped to
 * auth.uid(). Not an anon key behind a client-side passphrase: the anon key
 * ships in the bundle on a public Pages site, and a passphrase checked in
 * JavaScript is a suggestion, not a lock. Signing in produces a real JWT, and
 * the JWT is what the database checks.
 *
 * There is no sign-up path here on purpose. The account is created once, by
 * hand, in the Supabase dashboard — an open sign-up form on a public URL would
 * let anyone create an account, and while RLS would keep them out of your rows,
 * it is a door with no reason to exist.
 */

import { getDb, dbStatus } from './db.js';

export async function currentSession() {
  const db = getDb();
  if (!db) return null;
  const { data } = await db.auth.getSession();
  return data.session || null;
}

export async function signOut() {
  await getDb()?.auth.signOut();
  location.reload();
}

function showError(message) {
  const el = document.getElementById('gateErr');
  el.textContent = message;
  el.hidden = false;
}

/* Renders the gate and resolves once there is a session. The app is not
 * rendered behind it — nothing loads until there is a user to scope it to. */
export function showGate() {
  return new Promise(resolve => {
    const gate = document.getElementById('gate');
    const wrap = document.getElementById('appWrap');
    wrap.hidden = true;
    gate.hidden = false;

    /* Three states, and each wants something different from the reader: a
       working connection wants the form, a missing config wants the setup
       steps, and an unreachable CDN wants a retry. Collapsing them into one
       "couldn't connect" would hide which of the three actually happened. */
    const { ok, reason } = dbStatus();

    const lead = ok
      ? 'Sign in to continue.'
      : reason === 'unconfigured'
        ? 'Not connected to a database yet. Create your Supabase project, then fill in ' +
          '<b>assets/js/config.js</b> — the steps are in SETUP.md.'
        : 'Could not load the Supabase client from the CDN. That is a network problem ' +
          'rather than a sign-in problem — your data is untouched. Reload to try again.';

    gate.innerHTML = `
      <div class="gatebox">
        <div class="wordmark"><span class="mark" aria-hidden="true">📗</span>Ledger</div>
        <div class="lead">${lead}</div>
        ${ok ? `
        <form id="gateForm" autocomplete="on">
          <div class="fld">
            <label class="label" for="gateEmail">Email</label>
            <input id="gateEmail" type="email" autocomplete="username" required>
          </div>
          <div class="fld">
            <label class="label" for="gatePass">Password</label>
            <input id="gatePass" type="password" autocomplete="current-password" required>
          </div>
          <button class="go" type="submit" id="gateGo">Sign in</button>
        </form>
        <div class="gateerr" id="gateErr" hidden></div>` : ''}
        <div class="gatefoot">
          Single account &middot; every row scoped to you<br>
          ${ok ? 'Connected' : reason === 'unconfigured' ? 'Awaiting configuration' : 'Offline'}
        </div>
      </div>`;

    if (!ok) return;   // nothing to sign in to yet

    const form = document.getElementById('gateForm');
    form.onsubmit = async e => {
      e.preventDefault();
      const btn = document.getElementById('gateGo');
      const email = document.getElementById('gateEmail').value.trim();
      const password = document.getElementById('gatePass').value;

      btn.disabled = true;
      btn.textContent = 'Signing in…';
      document.getElementById('gateErr').hidden = true;

      const { data, error } = await getDb().auth.signInWithPassword({ email, password });

      btn.disabled = false;
      btn.textContent = 'Sign in';

      if (error) {
        /* Supabase says "Invalid login credentials" for a wrong password and for
           an address with no account, deliberately — distinguishing them tells a
           stranger which half they got right. Passed through unchanged. */
        showError(error.message);
        document.getElementById('gatePass').select();
        return;
      }

      gate.hidden = true;
      wrap.hidden = false;
      resolve(data.session);
    };

    document.getElementById('gateEmail').focus();
  });
}
