/* Ledger — calc-roundup
 *
 * A port of roundup.py's maths, with the email removed. Pulls categorized
 * transactions in the selected categories, rounds each up to the next dollar,
 * and totals the difference.
 *
 * The keyword groups below are roundup.py's ROUNDUP_KEYWORDS list, partitioned
 * so the UI's five chips each map onto the keywords they were standing in for.
 * Matching stays a case-insensitive substring test against the Lunch Money
 * category name, exactly as the Python does.
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
const GROUPS: Record<string, string[]> = {
  restaurants:    ['restaurant', 'dining'],
  'food-delivery': ['food delivery'],
  alcohol:        ['alcohol', 'bar'],
  rideshare:      ['rideshare', 'taxi', 'uber', 'lyft'],
  transit:        ['transit', 'subway'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    await requireLedgerUser(req);

    const { start, end, categories } = await req.json();
    if (!start || !end) return json({ error: 'start and end are required' }, 400);

    const chosen: string[] = Array.isArray(categories) && categories.length
      ? categories : Object.keys(GROUPS);
    const keywords = chosen.flatMap(c => GROUPS[c] || []);
    if (!keywords.length) return json({ error: 'no categories selected' }, 400);

    /* Which Lunch Money categories the keywords match, resolved once. */
    const catResp = await lm('/categories');
    const matched = new Map<number, string>();
    for (const cat of catResp.categories || []) {
      const name = String(cat.name || '');
      if (keywords.some(kw => name.toLowerCase().includes(kw))) matched.set(cat.id, name);
    }

    const txResp = await lm('/transactions', { start_date: start, end_date: end });
    const transactions = txResp.transactions || [];

    let uncategorized = 0, skippedNegative = 0;
    const byCategory: Record<string, { spend: number; save: number; count: number }> = {};
    let totalSpend = 0, totalSave = 0, count = 0;

    for (const t of transactions) {
      const catId = t.category_id;
      const amount = Number(t.amount ?? 0);

      /* Counted and reported rather than silently dropped — an uncategorised
         transaction in range is the one thing that makes the total wrong, and
         the user can fix it and re-run. */
      if (catId === null || catId === undefined) { uncategorized++; continue; }
      if (!matched.has(catId)) continue;
      /* Refunds and income would subtract from a round-up, which is meaningless. */
      if (amount <= 0) { skippedNegative++; continue; }

      const diff = Math.ceil(amount) - amount;   // an exact dollar rounds up to itself
      const name = matched.get(catId)!;

      byCategory[name] ||= { spend: 0, save: 0, count: 0 };
      byCategory[name].spend += amount;
      byCategory[name].save += diff;
      byCategory[name].count++;

      totalSpend += amount;
      totalSave += diff;
      count++;
    }

    return json({
      start, end,
      total: Math.round(totalSave * 100) / 100,
      spend: Math.round(totalSpend * 100) / 100,
      count,
      uncategorized,
      skippedNegative,
      byCategory: Object.entries(byCategory)
        .map(([name, v]) => ({
          name,
          save: Math.round(v.save * 100) / 100,
          spend: Math.round(v.spend * 100) / 100,
          count: v.count,
        }))
        .sort((a, b) => b.save - a.save),
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
});
