/* Ledger — sync-bills
 *
 * Pulls manually-set recurring items from Lunch Money and keeps the bill
 * definitions in step with them. Lunch Money owns what a bill IS; this app
 * owns whether it got paid and what it actually came to.
 *
 * Two rules make this safe to re-run:
 *
 * 1. Definitions are matched on lunchmoney_recurring_id and updated in place,
 *    so a bill never duplicates and its instances never orphan.
 * 2. Instances are generated forward from BILLS_FROM only. Recurring items
 *    carry history back to whenever the account started, and without a floor
 *    the first sync would manufacture months of already-paid bills and mark
 *    the calendar with them.
 *
 * Nothing here ever writes paid_at. Marking a bill paid is local, manual, and
 * the user's — see the note on autopay in the spec.
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
/* Kept in step with assets/js/config.js — the client shows the same floor. */
const BILLS_FROM = Deno.env.get('BILLS_FROM') || '2026-08-01';
const MONTHS_AHEAD = 3;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* Clamps to short months: a bill due on the 31st is due on the 28th in
   February, not silently in March. */
function dueOn(year: number, month: number, day: number) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { supabase } = await requireLedgerUser(req);

    const now = new Date();
    const resp = await lm('/recurring_items', { start_date: iso(now) });
    const items = resp.recurring_items || resp.recurring_expenses || [];

    /* Only what the user set by hand. Lunch Money also suggests recurring
       items it has inferred, and those are guesses this app should not
       present as bills. */
    const manual = items.filter((i: any) =>
      (i.source ?? 'manual') === 'manual' && Number(i.amount ?? 0) !== 0);

    const { data: existing, error: exErr } = await supabase
      .from('bills').select('id,lunchmoney_recurring_id,due_day,amount,name');
    if (exErr) throw exErr;

    const byRecurringId = new Map((existing || []).map(b => [b.lunchmoney_recurring_id, b]));
    const floor = new Date(BILLS_FROM + 'T00:00:00');
    const horizon = new Date(now.getFullYear(), now.getMonth() + MONTHS_AHEAD, 0);

    const created: string[] = [];
    const updated: string[] = [];
    let instances = 0;

    for (const item of manual) {
      const recurringId = String(item.id);
      const amount = Math.abs(Number(item.amount ?? 0));
      /* billing_date is the next occurrence; its day-of-month is the cycle. */
      const anchor = new Date((item.billing_date || item.start_date || iso(now)) + 'T00:00:00');
      const dueDay = anchor.getDate();

      const row = {
        name: item.payee || item.description || 'Untitled bill',
        category: item.category_name ?? null,
        amount,
        due_day: dueDay,
        is_auto: false,
        is_variable: false,
        lunchmoney_recurring_id: recurringId,
        active: true,
      };

      let billId = byRecurringId.get(recurringId)?.id;
      if (billId) {
        const { error } = await supabase.from('bills').update(row).eq('id', billId);
        if (error) throw error;
        updated.push(row.name);
      } else {
        const { data, error } = await supabase.from('bills').insert(row).select('id').single();
        if (error) throw error;
        billId = data.id;
        created.push(row.name);
      }

      /* Instances from the floor forward, never behind it. */
      let cursor = new Date(Math.max(floor.getTime(), new Date(now.getFullYear(), now.getMonth(), 1).getTime()));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);

      while (cursor <= horizon) {
        const due = dueOn(cursor.getFullYear(), cursor.getMonth(), dueDay);
        if (due >= floor) {
          /* onConflict leaves an existing instance untouched, so a paid_at or
             an edited amount is never overwritten by a later sync. */
          const { error } = await supabase.from('bill_instances')
            .upsert({ bill_id: billId, due_date: iso(due), amount },
                    { onConflict: 'bill_id,due_date', ignoreDuplicates: true });
          if (error) throw error;
          instances++;
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }
    }

    return json({
      synced_at: new Date().toISOString(),
      from: BILLS_FROM,
      recurring_items: manual.length,
      created, updated, instances_considered: instances,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
});
