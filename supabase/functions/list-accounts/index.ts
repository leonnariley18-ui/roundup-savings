/* Ledger — list-accounts
 *
 * Every account Lunch Money knows about, so the linking screen can offer them
 * by name rather than guessing at digits.
 *
 * Read-only. It exists purely so the browser can show a list without ever
 * holding the token.
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
    await requireLedgerUser(req);

    /* Cards land in either collection depending on how they were added —
       manually as an asset, or through Plaid. Both are offered. */
    const [assets, plaid] = await Promise.all([
      lm('/assets').catch(() => ({ assets: [] })),
      lm('/plaid_accounts').catch(() => ({ plaid_accounts: [] })),
    ]);

    const accounts = [
      ...(assets.assets || []).map((a: any) => ({
        id: `asset:${a.id}`,
        name: a.display_name || a.name,
        mask: null,
        type: a.type_name || 'manual',
        balance: Math.abs(Number(a.balance ?? 0)),
      })),
      ...(plaid.plaid_accounts || []).map((a: any) => ({
        id: `plaid:${a.id}`,
        name: a.display_name || a.name,
        mask: a.mask || null,
        type: a.type || 'plaid',
        balance: Math.abs(Number(a.balance ?? 0)),
      })),
    ];

    /* Credit cards first — that is what is being linked — but everything is
       returned, because Lunch Money's type names are not dependable enough to
       hide an account behind. */
    const isCard = (t: string) => /credit|card/i.test(t || '');
    accounts.sort((a, b) =>
      Number(isCard(b.type)) - Number(isCard(a.type)) || a.name.localeCompare(b.name));

    return json({ accounts });
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
});
