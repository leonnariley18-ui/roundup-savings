-- Ledger — the Lunch tab: a $40/day budget with rollover
-- Run after 0008. Safe to re-run.
--
-- Weekdays only — a lunch budget has nothing to say about Saturday and
-- Sunday. There is deliberately no "week" table: a week is just Monday
-- through Friday of a date, derived the same way the rest of the app derives
-- its calendar math, never stored as its own entity. "This week" and "closed
-- weeks" are both just lunch_days grouped by mon(on_date) on the client.
--
-- Rollover is `rollover_base` (a checkpoint, moved forward by "zero out")
-- plus the sum of (that day's own limit − spent) for every weekday after the
-- checkpoint, paused days excluded entirely. Each lunch_days row snapshots
-- the limit that was active the day it was created, which is what makes a
-- scheduled limit change — the only way the limit is ever allowed to change,
-- always effective on a Monday — correct without rewriting history: a day
-- created before the change keeps its old limit, a day created after gets
-- the new one, and the rollover sum is already right without special-casing
-- the boundary.

create table if not exists ledger.lunch_settings (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  daily_limit          numeric(10,2) not null default 40 check (daily_limit > 0),
  scheduled_limit      numeric(10,2),
  scheduled_limit_monday date,          -- null unless a change is pending; always a Monday
  rollover_base        numeric(10,2) not null default 0,
  rollover_base_date   date not null default current_date,   -- "zero out" moves this to today
  tracking_paused      boolean not null default false,       -- carries forward onto whichever day is "today" next
  -- The one piece of state that isn't derivable from "what day is it":
  -- which Monday is still open. It only ever advances once every weekday in
  -- it is resolved (ended or paused) — that's what makes a backlog block a
  -- new week from starting instead of silently rolling past it, and what
  -- lets a long absence jump straight to the real current week the moment
  -- the stuck one finally clears, rather than stepping through every week
  -- that passed in between.
  open_week_start      date not null default date_trunc('week', current_date)::date,
  updated_at           timestamptz not null default now()
);

create table if not exists ledger.lunch_days (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  on_date      date not null,
  daily_limit  numeric(10,2) not null,     -- snapshot of the limit in effect when this day was created
  ended_at     timestamptz,
  paused       boolean not null default false,
  unique (user_id, on_date)
);
create index if not exists lunch_days_user_date_idx on ledger.lunch_days (user_id, on_date);

create table if not exists ledger.lunch_purchases (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  on_date    date not null,
  label      text not null,
  amount     numeric(10,2) not null check (amount > 0),
  source     text not null default 'manual' check (source in ('manual','dunkin','ubereats')),
  created_at timestamptz not null default now()
);
create index if not exists lunch_purchases_user_date_idx on ledger.lunch_purchases (user_id, on_date);

-- A dated, human-readable record of actions that touch money or settings —
-- limit changes, zero-outs, pause/resume, backfills. Not routine logging
-- (purchases, ending a day); those are already visible as data, not actions
-- to audit.
create table if not exists ledger.lunch_activity (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  on_date    date not null,
  text       text not null,
  created_at timestamptz not null default now()
);
create index if not exists lunch_activity_user_date_idx on ledger.lunch_activity (user_id, created_at desc);

-- ---------------------------------------------------------------- security

do $$
declare t text;
begin
  foreach t in array array['lunch_settings','lunch_days','lunch_purchases','lunch_activity'] loop
    execute format('alter table ledger.%I enable row level security', t);
    execute format('alter table ledger.%I force row level security', t);
    execute format('grant select, insert, update, delete on ledger.%I to authenticated', t);
    execute format('alter table ledger.%I alter column user_id set default auth.uid()', t);
    execute format('drop policy if exists owner_all on ledger.%I', t);
    execute format(
      'create policy owner_all on ledger.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;
