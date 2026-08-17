/* Ledger — sync-card-balances
 *
 * Required, not optional. current_balance drives two ranking rules — the
 * utilization penalty and the carrying-a-balance exclusion — so a stale manual
 * figure silently produces a wrong answer with a stated reason that is no
 * longer true.
 *
 * Plaid lag is real, and Lunch Money exposes a single background-synced
 * balance. A day or two of lag is irrelevant to a rule whose threshold is "any
 * balance at all", but the timestamp is stored so every balance can show its
 * age rather than pretending to be live.
 */

/* Ledger — shared Edge Function helpers
 *
 * The Lunch Money token lives in Supabase secrets and is only ever read here.
 * It must never reach the client, which is the entire reason these functions
 * exist rather than the browser calling Lunch Money directly.
 */

export const LM_BASE = 'https://dev.lunchmoney.app/v1';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export async function lm(path: string, params: Record<string, string> = {}) {
  const token = Deno.env.get('LUNCHMONEY_TOKEN');
  if (!token) throw new Error('LUNCHMONEY_TOKEN is not set in Supabase secrets');

  const url = new URL(LM_BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Lunch Money ${path} returned ${res.status}`);
  return res.json();
}

/* Establishes who is calling, and refuses anyone else.
 *
 * This project is shared with another application, so a valid JWT is not on
 * its own proof that the caller is the Ledger user — if that app allows
 * sign-ups, anyone holding an account presents a valid JWT. Without this check
 * a stranger could spend the Lunch Money token and read the spending it
 * returns. LEDGER_USER_ID is set alongside the token in secrets.
 */
export async function requireLedgerUser(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Not signed in');

  const { createClient } = await import('jsr:@supabase/supabase-js@2');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } }, db: { schema: 'ledger' } },
  );

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Not signed in');

  const allowed = Deno.env.get('LEDGER_USER_ID');
  if (!allowed) throw new Error('LEDGER_USER_ID is not set in Supabase secrets');
  if (data.user.id !== allowed) throw new Error('This function is not for your account');

  /* Returned with the caller's JWT attached, so every write it makes is
     scoped by RLS exactly as the browser's would be. No service_role key is
     used anywhere in these functions. */
  return { supabase, userId: data.user.id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { supabase } = await requireLedgerUser(req);

    /* Credit cards can sit in either collection depending on how they were
       linked, so both are read and merged. */
    const [assets, plaid] = await Promise.all([
      lm('/assets').catch(() => ({ assets: [] })),
      lm('/plaid_accounts').catch(() => ({ plaid_accounts: [] })),
    ]);

    /* Keyed by the same composite id the linking screen stored. */
    const byId = new Map<string, number>();
    for (const a of assets.assets || []) byId.set(`asset:${a.id}`, Number(a.balance ?? 0));
    for (const a of plaid.plaid_accounts || []) byId.set(`plaid:${a.id}`, Number(a.balance ?? 0));

    const { data: cards, error } = await supabase
      .from('cards').select('id,name,last4,lunchmoney_account_id');
    if (error) throw error;

    const now = new Date().toISOString();
    const updated: string[] = [];
    const unmatched: string[] = [];

    for (const card of cards || []) {
      const link = card.lunchmoney_account_id;

      /* Only cards someone has explicitly linked. An undecided card is not a
         failure to report — it just has not been through the linking screen —
         and 'none' means the user said it is not in Lunch Money at all. */
      if (!link || link === 'none') continue;

      if (!byId.has(link)) {
        /* The link points at an account that no longer exists. Named rather
           than silently skipped, because the balance is now frozen. */
        unmatched.push(card.name);
        continue;
      }

      /* Lunch Money reports card balances as a positive amount owed. */
      const balance = Math.abs(byId.get(link)!);
      const { error: upErr } = await supabase.from('cards')
        .update({ current_balance: balance, balance_synced_at: now, balance_source: 'lunchmoney' })
        .eq('id', card.id);
      if (upErr) throw upErr;
      updated.push(`${card.name}: ${balance.toFixed(2)}`);
    }

    return json({ synced_at: now, updated, unmatched });
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
});
