-- Ledger — bill_instances.amount must be nullable
-- Run after 0007. Read the comment before running the UPDATE at the bottom
-- against real data — it rewrites rows, and is included here for review
-- rather than assumed safe to run blind.
--
-- occurrencesWithState() in assets/js/bills.js was always written expecting
-- this column to be nullable — "row.amount != null ? use it : fall back to
-- the bill's own amount" — but the column was declared `not null default 0`.
-- The first time any bill is ticked (or its reminder toggled), touchOccurrence()
-- upserts only {bill_id, due_date, paid_at}; on a brand-new row, Postgres fills
-- the missing amount column with its default, 0. Since 0 is not null, every
-- read from then on prefers that 0 over the bill's real amount — permanently,
-- for a bill nobody ever meant to zero out.

alter table ledger.bill_instances alter column amount drop not null;
alter table ledger.bill_instances alter column amount drop default;

-- ---------------------------------------------------------------- data repair
--
-- Rows already sitting at amount = 0 are very likely artifacts of the bug
-- above rather than a deliberate "$0.00 this time" override — those are rare
-- enough (and typing $0 is itself a valid thing to do) that this only
-- resets rows where the parent bill clearly has a real, non-zero amount of
-- its own, so a genuine intentional $0 override on a bill that is *itself*
-- variable/unset is left alone.
--
-- Review what this would touch first:
--   select bi.id, b.name, bi.due_date, bi.paid_at, b.amount as bill_amount
--   from ledger.bill_instances bi
--   join ledger.bills b on b.id = bi.bill_id
--   where bi.amount = 0 and b.amount is not null and b.amount > 0;
--
-- Then, only once reviewed:
--   update ledger.bill_instances bi
--   set amount = null
--   from ledger.bills b
--   where b.id = bi.bill_id
--     and bi.amount = 0
--     and b.amount is not null and b.amount > 0;
