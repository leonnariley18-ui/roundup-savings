-- Ledger — bills you enter yourself, and four smaller things
-- Run after 0005. Safe to re-run.
--
-- Bills were shaped by Lunch Money's recurring items: an amount and a day of
-- the month. What a bill actually needs is a start, sometimes an end, a
-- cadence, and — for anything on autopay — a reminder to get the funds in
-- place before it fires. None of that exists in a recurring item, so syncing
-- would have produced a poorer object that still had to be maintained by hand.

-- ---------------------------------------------------------------- bills

alter table ledger.bills
  add column if not exists cadence text not null default 'monthly',
  add column if not exists starts_on date not null default current_date,
  add column if not exists ends_on date,                 -- null = ongoing or not yet known
  add column if not exists reminder_days_before int,     -- null = no reminder
  add column if not exists reminder_text text,
  add column if not exists notes text;

do $$ begin
  alter table ledger.bills add constraint bills_cadence_check
    check (cadence in ('monthly','weekly','biweekly','quarterly','yearly','once'));
exception when duplicate_object then null; end $$;

-- starts_on is the anchor for every cadence: its day-of-month for monthly,
-- quarterly and yearly, its weekday for weekly and biweekly. due_day is left in
-- place for the rows that predate this and is no longer required.
alter table ledger.bills alter column due_day drop not null;

-- ------------------------------------------------------- bill occurrences
--
-- A bill's occurrences are derived from its definition rather than stored.
-- Generating rows ahead would mean a scheduled job, thousands of rows nobody
-- looks at, and a horizon that silently runs out. So bill_instances holds only
-- what the user has actually touched: a tick, an edited amount, a reminder
-- dealt with. An occurrence with no row is simply one nothing has happened to.

alter table ledger.bill_instances
  add column if not exists reminder_done_at date;

-- ---------------------------------------------------------------- payday
--
-- Payday is Thursday. Occasionally it isn't — a holiday moves it to Friday.
-- One row says "this week, payday is this date instead", and the week it
-- belongs to is derived from the date rather than stored alongside it.

create table if not exists ledger.payday_overrides (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  on_date date not null,
  unique (user_id, on_date)
);

-- ---------------------------------------------------------------- round-ups
--
-- Still no amount — that lives in the bank. But which range was swept is a fact
-- about what you did, and without it a marker months later says nothing.

alter table ledger.roundup_runs
  add column if not exists range_start date,
  add column if not exists range_end date;

-- ---------------------------------------------------------------- paybacks
--
-- An off-card payback was only ever "not a card", which does not tell you in
-- three weeks whether it was Affirm or a friend.

alter table ledger.paybacks
  add column if not exists off_card_label text;

-- ---------------------------------------------------------------- security

alter table ledger.payday_overrides enable row level security;
alter table ledger.payday_overrides force row level security;
grant select, insert, update, delete on ledger.payday_overrides to authenticated;
alter table ledger.payday_overrides alter column user_id set default auth.uid();

drop policy if exists owner_all on ledger.payday_overrides;
create policy owner_all on ledger.payday_overrides
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
