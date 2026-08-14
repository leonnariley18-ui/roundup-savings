/* Ledger — Supabase client
 *
 * Loaded straight from a CDN as an ES module. The constraint is that this must
 * run entirely in a browser with no build step, and a pinned esm.sh import
 * satisfies that without a bundler, a package.json, or a node_modules to keep
 * in sync. The version is pinned rather than floating so a publish upstream
 * can never change what the live site is running.
 *
 * The import is dynamic and its failure is caught. A static import would put
 * the CDN in the module graph of the whole app, and a single unreachable
 * request — a CDN blip, a blocked domain, a captive portal — would stop every
 * module from evaluating and render a blank white page with nothing to read.
 * Failing this way costs the database and nothing else: the shell still draws
 * and the banner says what happened.
 *
 * No DOM in this file — the data layer stays UI-agnostic so the planned mobile
 * frontend can sit on it without refactoring.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.js';

const CDN = 'https://esm.sh/@supabase/supabase-js@2.45.4';

let client = null;
let status = { ok: false, reason: 'unconfigured' };

/* Reasons are distinguished because they need different things from the user:
 * 'unconfigured' is a setup step they have not done yet, 'unreachable' is a
 * network problem they can only retry. Telling them apart is the difference
 * between a useful message and "something went wrong". */
export const dbStatus = () => status;
export const getDb = () => client;

export async function initDb() {
  if (client) return client;

  if (!isConfigured()) {
    status = { ok: false, reason: 'unconfigured' };
    return null;
  }

  try {
    const { createClient } = await import(/* @vite-ignore */ CDN);
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    status = { ok: true, reason: null };
    return client;
  } catch (err) {
    status = { ok: false, reason: 'unreachable', error: err };
    return null;
  }
}

/* Unwraps the { data, error } shape so callers read as plain awaits. Errors
 * throw rather than returning a falsy value, because a silent empty list is
 * indistinguishable from a real empty table — and this app has several
 * screens whose whole job is to be honestly empty. */
export async function run(query) {
  if (!client) throw new Error('Not connected to Supabase — see SETUP.md');
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
