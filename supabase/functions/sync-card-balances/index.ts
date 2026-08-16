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

import { lm, json, corsHeaders, requireLedgerUser } from '../_shared/lunchmoney.ts';

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
