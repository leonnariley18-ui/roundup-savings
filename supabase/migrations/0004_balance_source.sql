-- Ledger — where a balance came from
-- Run this after 0003. Safe to re-run.
--
-- current_balance drives two ranking rules: any balance at all excludes a card
-- from recommendations, and utilization over 30% pushes it down. So a figure
-- that is wrong does not merely mislead — it produces a confident answer with a
-- stated reason that is no longer true.
--
-- The original design had balances syncing from Lunch Money and never being
-- typed. That holds only while the cards are actually linked. When they are
-- not, the alternative is not "no manual value" — it is the seeded figure
-- sitting there forever, with nothing to say how old it is.
--
-- So a balance now records where it came from and when it last moved, and the
-- UI shows both. A number you entered last week is useful; the same number
-- presented as current is not.

alter table ledger.cards
  add column if not exists balance_source text not null default 'seed'
  check (balance_source in ('seed', 'manual', 'lunchmoney'));

comment on column ledger.cards.balance_source is
  'seed = from setup and never touched; manual = typed in, trust balance_synced_at; lunchmoney = from sync-card-balances';
