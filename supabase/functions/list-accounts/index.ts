/* Ledger — list-accounts
 *
 * Every account Lunch Money knows about, so the linking screen can offer them
 * by name rather than guessing at digits.
 *
 * Read-only. It exists purely so the browser can show a list without ever
 * holding the token.
 */

import { lm, json, corsHeaders, requireLedgerUser } from '../_shared/lunchmoney.ts';

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
