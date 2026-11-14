-- Running checkpoint for "average spend per week", same shape as
-- rollover_base/rollover_base_date: a sum + a count, incremented once per
-- closed week instead of recomputed from full history on every load.
-- Left nullable (not defaulted to 0) so the app can tell "never
-- initialized" apart from "zero weeks counted so far" and run a one-time
-- backfill from existing history the first time this ships.
alter table ledger.lunch_settings add column if not exists avg_spend_total numeric(10,2);
alter table ledger.lunch_settings add column if not exists avg_spend_weeks integer;
