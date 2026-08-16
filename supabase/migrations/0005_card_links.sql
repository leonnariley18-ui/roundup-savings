-- Ledger — explicit Lunch Money links
-- Run this after 0004. Safe to re-run.
--
-- Balances were matched by last four digits, which guesses. An account
-- nicknamed "Amex" with no digits in it never matches however many times you
-- sync, and nothing says why. Worse, a wrong guess is invisible: the balance
-- just quietly belongs to a different card.
--
-- So the link is stated once and stored. Last-four matching survives only as a
-- suggestion in the linking screen, where a person confirms it.
--
-- Three states, and they are all meaningful:
--   null                     -- not decided yet; the linking screen asks
--   a Lunch Money account id -- linked; the sync owns this balance
--   'none'                   -- deliberately not in Lunch Money; yours to type

alter table ledger.cards
  add column if not exists lunchmoney_account_id text;

comment on column ledger.cards.lunchmoney_account_id is
  'null = undecided, ''none'' = deliberately unlinked, otherwise the Lunch Money asset or plaid account id';
