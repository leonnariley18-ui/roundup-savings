-- Save: sweeping Lunch's banked rollover into actual savings, on a weekly
-- cadence of its own. No "week" row is ever stored — a week is just a
-- Monday, and every open week's own target is looked up from
-- save_target_history rather than snapshotted onto a row, since nothing
-- ever happens to a week before it gets swept. The one thing that can't be
-- derived is which Monday is the earliest not-yet-swept week; that lives on
-- save_settings.open_week_start, same role as Lunch's open_week_start.

create table if not exists ledger.save_settings (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  weekly_target          numeric(10,2),                 -- null = never started
  scheduled_target       numeric(10,2),
  scheduled_target_monday date,
  open_week_start        date,                          -- null until started
  updated_at             timestamptz not null default now()
);

-- One row per Monday a target took effect. A week's own target is whichever
-- row has the latest effective_monday at or before that week's Monday —
-- looked up at render/sweep time, never written onto the week itself.
create table if not exists ledger.save_target_history (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  effective_monday date not null,
  target           numeric(10,2) not null check (target > 0),
  created_at       timestamptz not null default now(),
  unique (user_id, effective_monday)
);
create index if not exists save_target_history_user_idx on ledger.save_target_history (user_id, effective_monday);

create table if not exists ledger.save_sweeps (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  swept_on      date not null,
  weeks_from    date not null,
  weeks_to      date not null,
  weeks_count   int not null check (weeks_count > 0),
  target_total  numeric(10,2) not null,
  total_amount  numeric(10,2) not null check (total_amount >= 0),
  treat_amount  numeric(10,2) not null default 0 check (treat_amount >= 0),
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists save_sweeps_user_idx on ledger.save_sweeps (user_id, swept_on desc);

create table if not exists ledger.save_activity (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  on_date    date not null,
  text       text not null,
  created_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['save_settings','save_target_history','save_sweeps','save_activity']
  loop
    execute format('alter table ledger.%I enable row level security', t);
    execute format('alter table ledger.%I force row level security', t);
    execute format('grant select, insert, update, delete on ledger.%I to authenticated', t);
    execute format('alter table ledger.%I alter column user_id set default auth.uid()', t);
    execute format(
      'create policy owner_all on ledger.%I using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;
