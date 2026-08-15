-- Ledger — seed
-- Run this third, then call it with your own user id. See SETUP.md:
--
--   select ledger.seed_ledger('00000000-0000-0000-0000-000000000000');
--
-- It is a function taking a user id rather than a plain script because
-- auth.uid() is null in the SQL editor — there is no session there to read.
--
-- Seeds nothing but the cards and the loan. bills, bill_instances, paybacks,
-- card_decisions, statement_closes, notes and roundup_runs all start empty, so
-- every screen shows a real empty state that says what to do rather than
-- plausible fiction.

create or replace function ledger.seed_ledger(uid uuid)
returns text
language plpgsql
security invoker
as $$
declare
  wf uuid; chase uuid; bofa uuid; pp uuid; amex uuid; rr uuid;
begin
  if exists (select 1 from ledger.cards where user_id = uid) then
    return 'Already seeded — nothing written. Delete the existing cards first if you meant to start over.';
  end if;

  -- ------------------------------------------------------------ the cards
  -- Balances and APRs as of Aug 2026.

  -- Wells Fargo's APR seeds as NULL, not a placeholder. It is genuinely not
  -- known, and the Statements tab surfaces it as a gap to fill. A stand-in
  -- number would silently become a fact nobody remembers inventing.
  insert into ledger.cards (user_id, name, last4, close_day, due_day, credit_limit,
                     current_balance, apr, flag_kind, flag_text, notes)
  values (uid, 'Wells Fargo Autograph', '0557', 7, 1, 17500, 0, null, 'good',
    'Points are worth 1¢ each on every standard redemption, so 3x really is 3%.',
    '3x points on restaurants, travel, gas, transit, streaming and phone plans. No foreign transaction fees.')
  returning id into wf;

  insert into ledger.cards (user_id, name, last4, close_day, due_day, credit_limit,
                     current_balance, apr, flag_kind, flag_text, notes)
  values (uid, 'Chase Prime Visa', '1856', 16, 13, 9600, 0, 27.49, 'watch',
    'The 5% is narrow — online means Amazon, travel means Chase Travel. Anywhere else falls to 1%.',
    '5% on Amazon and Chase Travel, 2% on restaurants, gas and transit.')
  returning id into chase;

  insert into ledger.cards (user_id, name, last4, close_day, due_day, credit_limit,
                     current_balance, apr, cap_limit, notes)
  values (uid, 'BofA Customized Cash', '0516', 19, 16, 8000, 0, 26.24, 2500,
    '3% in your chosen category and 2% on groceries, both capped at $2,500 combined per quarter, then 1%.')
  returning id into bofa;

  insert into ledger.cards (user_id, name, last4, close_day, due_day, credit_limit,
                     current_balance, apr, flag_kind, flag_text, notes)
  values (uid, 'PayPal Credit Card', '3731', 10, 2, 6500, 38, 29.64, 'watch',
    'Pays nothing unless you activated an offer first. Worth a sweep at the start of the month.',
    'No automatic rewards. Anything back has to come from an offer you activated first.')
  returning id into pp;

  insert into ledger.cards (user_id, name, last4, close_day, due_day, credit_limit,
                     current_balance, apr, flag_kind, flag_text, notes)
  values (uid, 'Amex Blue Cash Everyday', '1005', 12, 6, 5000, 288, 26.49, 'watch',
    'Pays nothing unless you activated an offer first. Worth a sweep at the start of the month.',
    'No rewards on this tier. Anything back has to come from an offer you activated first.')
  returning id into amex;

  -- Real Rewards' close date is unconfirmed — reported between the 15th and the
  -- 19th, which is the signature of a rolling cycle rather than a fixed day.
  -- Seed the midpoint, put the uncertainty in reported_note, let calibration
  -- resolve it from observations.
  insert into ledger.cards (user_id, name, last4, close_day, due_day, credit_limit,
                     current_balance, apr, reported_note, flag_kind, flag_text, notes)
  values (uid, 'Real Rewards Visa', '1936', 17, 10, 3000, 0, 33.24,
    'Closes somewhere between the 15th and 19th — needs pinning down', 'watch',
    'Your best flat rate at 2% — but your worst APR at 33.24%, so only if it clears before close.',
    '2% back on everything — the best flat rate you hold. Plus 40 points per $1 on American Eagle clothing.')
  returning id into rr;

  -- ------------------------------------------------------------ rewards
  -- category null = the base rate.
  -- PayPal and Amex Blue Cash get no rows at all. That is not an omission: they
  -- earn nothing automatically, and their offers are activated one at a time in
  -- an app this tool never sees. No rows is the honest representation, and the
  -- UI reads "no reward rows" as offers-only.

  insert into ledger.card_rewards (user_id, card_id, category, value, unit, label_note) values
    (uid, wf, null,        1, 'points', null),
    (uid, wf, 'dining',    3, 'points', null),
    (uid, wf, 'travel',    3, 'points', null),
    (uid, wf, 'gas',       3, 'points', null),
    (uid, wf, 'transit',   3, 'points', null),
    (uid, wf, 'streaming', 3, 'points', null),
    (uid, wf, 'phone',     3, 'points', null),

    (uid, chase, null,      1, 'pct', null),
    (uid, chase, 'online',  5, 'pct', 'Amazon only'),
    (uid, chase, 'travel',  5, 'pct', 'Chase Travel only'),
    (uid, chase, 'dining',  2, 'pct', null),
    (uid, chase, 'gas',     2, 'pct', null),
    (uid, chase, 'transit', 2, 'pct', null),

    (uid, bofa, null, 1, 'pct', null),

    (uid, rr, null, 2, 'pct', null),
    (uid, rr, 'ae', 2, 'pct', 'plus 40 pts per $1 in AE points');

  -- Groceries count against the same $2,500 quarterly budget as the chosen 3%
  -- category, so it is the cap flag that matters here, not the rate.
  insert into ledger.card_rewards (user_id, card_id, category, value, unit, counts_toward_cap)
  values (uid, bofa, 'grocery', 2, 'pct', true);

  -- BofA's switchable 3% slot lives in its own table rather than in card_rewards,
  -- because it is a choice with a history, not a property of the card. The
  -- current choice is the row with the latest effective_from.
  insert into ledger.card_choice_categories (user_id, card_id, category, effective_from)
  values (uid, bofa, 'online', date '2026-08-01');

  -- ------------------------------------------------------------ the loan
  -- $10,000 SoFi consolidation. Nothing paid yet as of Aug 2026 — the first
  -- payment posts 9/5/2026, so debt_payments stays empty and every figure the
  -- loan screen shows is labelled a projection until a real row exists.
  insert into ledger.debts (user_id, name, principal, apr, minimum_payment, actual_payment,
                     start_date, term_months, current_balance, status)
  values (uid, 'SoFi consolidation', 10000, 11.95, 223.65, 350,
          date '2026-09-05', 60, 10000, 'active');

  return 'Seeded: 6 cards, 16 reward rows, BofA''s 3% category, and the SoFi loan.';
end $$;
