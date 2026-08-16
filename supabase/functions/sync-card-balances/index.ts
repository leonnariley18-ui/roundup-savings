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

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

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

    const accounts = [
      ...(assets.assets || []).map((a: any) => ({
        name: a.display_name || a.name, mask: a.display_name || a.name,
        balance: Number(a.balance ?? 0), type: a.type_name,
      })),
      ...(plaid.plaid_accounts || []).map((a: any) => ({
        name: a.display_name || a.name, mask: a.mask,
        balance: Number(a.balance ?? 0), type: a.type,
      })),
    ];

    const { data: cards, error } = await supabase.from('cards').select('id,name,last4');
    if (error) throw error;

    const now = new Date().toISOString();
    const updated: string[] = [];
    const unmatched: string[] = [];

    for (const card of cards || []) {
      /* Matched on the last four digits, which is the only identifier both
         sides reliably share — display names get renamed. */
      const hit = accounts.find(a => digits(a.mask).endsWith(card.last4)) ||
                  accounts.find(a => digits(a.name).endsWith(card.last4));
      if (!hit) { unmatched.push(card.name); continue; }

      /* Lunch Money reports card balances as a positive amount owed. */
      const balance = Math.abs(hit.balance);
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
