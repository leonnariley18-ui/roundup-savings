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

import { lm, json, corsHeaders, requireLedgerUser } from '../_shared/lunchmoney.ts';

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
