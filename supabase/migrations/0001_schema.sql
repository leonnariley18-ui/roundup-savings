-- Ledger — schema
-- Run this first, in the Supabase SQL editor. See SETUP.md.
--
-- Everything lives in a dedicated `ledger` schema, never in `public`. This app
-- is designed to be a guest in a Supabase project that already has another
-- application in it: the table names here (cards, bills, notes, events) are
-- generic enough to collide, and a separate schema means it cannot clash with,
-- read, or damage anything already in the database. It also means the whole
-- app can be removed later with a single `drop schema ledger cascade`.
--
-- Every table carries user_id. The spec's schema listing omits it, but auth is
-- "RLS scoped to auth.uid()", and a policy needs a column to scope against.
-- Child tables carry it directly rather than reaching through their parent —
-- a policy that joins is slower and harder to read, and the value can never
-- disagree because nothing writes these tables but the owner.

create extension if not exists "pgcrypto";

create schema if not exists ledger;

-- ---------------------------------------------------------------- cards

create table if not exists ledger.cards (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  last4           text not null,
  close_day       int  not null,            -- what the user entered; working truth until observed
  due_day         int  not null,
  due_mode        text not null default 'fixed' check (due_mode in ('fixed','offset')),
  credit_limit    numeric(12,2) not null default 0,
  current_balance numeric(12,2) not null default 0,
  balance_synced_at timestamptz,            -- Plaid lag is real; every balance shows its age
  apr             numeric(6,2),             -- NULLABLE. Wells Fargo's is genuinely unknown.
  annual_fee      numeric(10,2) not null default 0,
  promo_apr_end   date,
  reported_note   text,                     -- the user's own uncertainty, e.g. "closes 15th-19th"
  flag_kind       text check (flag_kind in ('good','watch')),
  flag_text       text,                     -- surfaced contextually; see Which card
  cap_limit       numeric(12,2),            -- BofA's $2,500/quarter. Null = no cap.
  cap_blown       bool not null default false,
  notes           text,
  active          bool not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists cards_user_idx on ledger.cards (user_id) where active;

-- A card with no reward rows earns nothing automatically — that is how PayPal
-- and Amex Blue Cash are represented. Their rewards come from offers the user
-- activates one at a time, which this app never sees, so there is nothing to store.
create table if not exists ledger.card_rewards (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  card_id           uuid not null references ledger.cards(id) on delete cascade,
  category          text,                   -- null = the base rate
  value             numeric(8,2) not null,
  unit              text not null check (unit in ('pct','points')),
  counts_toward_cap bool not null default false,
  label_note        text,
  rotating          bool not null default false
);
create index if not exists card_rewards_card_idx on ledger.card_rewards (card_id);

-- BofA's switchable 3% slot. Append a row to change it; the current choice is
-- the one with the latest effective_from, so the history stays intact.
create table if not exists ledger.card_choice_categories (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  card_id        uuid not null references ledger.cards(id) on delete cascade,
  category       text not null,
  effective_from date not null default current_date
);
create index if not exists card_choice_card_idx on ledger.card_choice_categories (card_id, effective_from desc);

-- "I used this card" — written only from the recommendation. There is no way to
-- log a different card, so there is no adherence rate to compute.
create table if not exists ledger.card_decisions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  card_id       uuid not null references ledger.cards(id) on delete cascade,
  category      text not null,
  amount        numeric(12,2),              -- NULLABLE; the amount is optional
  reward_pct    numeric(8,4) not null,
  reward_amount numeric(12,2),
  decided_at    timestamptz not null default now()   -- the scrubbed date, not necessarily now
);
create index if not exists card_decisions_user_idx on ledger.card_decisions (user_id, decided_at desc);

-- OBSERVED CLOSES ONLY. Never write a prediction here — the pattern is derived
-- at read time, and a predicted row would feed itself back in as evidence.
create table if not exists ledger.statement_closes (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  card_id   uuid not null references ledger.cards(id) on delete cascade,
  closed_on date not null,
  source    text not null default 'manual',
  logged_at timestamptz not null default now(),
  unique (card_id, closed_on)
);
create index if not exists statement_closes_card_idx on ledger.statement_closes (card_id, closed_on desc);

-- ---------------------------------------------------------------- paybacks

create table if not exists ledger.paybacks (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  description         text not null,
  amount              numeric(12,2) not null check (amount > 0),
  card_id             uuid references ledger.cards(id) on delete set null,  -- NULL = off-card
  incurred_on         date not null default current_date,
  intended_payback_on date not null,
  moves               int  not null default 0,   -- reschedule count; stored, never displayed
  status              text not null default 'open' check (status in ('open','cleared','became_bill')),
  dismissed           bool not null default false,
  created_at          timestamptz not null default now()
);
create index if not exists paybacks_user_idx on ledger.paybacks (user_id, status);

create table if not exists ledger.payback_payments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  payback_id uuid not null references ledger.paybacks(id) on delete cascade,
  amount     numeric(12,2) not null check (amount > 0),
  paid_at    date not null default current_date
);
create index if not exists payback_payments_pb_idx on ledger.payback_payments (payback_id);

-- ---------------------------------------------------------------- bills

create table if not exists ledger.bills (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  name                   text not null,
  category               text,
  amount                 numeric(12,2) not null default 0,
  due_day                int  not null,
  is_auto                bool not null default false,
  is_variable            bool not null default false,
  links_to_debt_id       uuid,              -- ticking this bill logs a loan payment
  lunchmoney_recurring_id text,
  active                 bool not null default true
);
create index if not exists bills_user_idx on ledger.bills (user_id) where active;

create table if not exists ledger.bill_instances (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  bill_id          uuid not null references ledger.bills(id) on delete cascade,
  due_date         date not null,
  amount           numeric(12,2) not null default 0,
  paid_at          date,
  autopay_override bool not null default false,   -- "not on autopay this month"
  unique (bill_id, due_date)
);
create index if not exists bill_instances_date_idx on ledger.bill_instances (user_id, due_date);

-- ---------------------------------------------------------------- notes, round-ups

create table if not exists ledger.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  on_date    date not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists notes_date_idx on ledger.notes (user_id, on_date);

-- A date only, deliberately. The amount lives in the bank, not here — a
-- contribution tracker that never sees withdrawals drifts into fiction.
create table if not exists ledger.roundup_runs (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ran_on  date not null,
  unique (user_id, ran_on)          -- can't double-log the same date
);

-- ---------------------------------------------------------------- the loan

create table if not exists ledger.debts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  principal       numeric(12,2) not null,
  apr             numeric(6,2) not null,
  minimum_payment numeric(12,2) not null,
  actual_payment  numeric(12,2) not null,
  start_date      date not null,
  term_months     int not null,
  current_balance numeric(12,2) not null,
  status          text not null default 'active'
);

-- Both portions are stored rather than recomputed, so history stays accurate
-- if the rate ever changes. source distinguishes manual from a future matcher.
create table if not exists ledger.debt_payments (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  debt_id           uuid not null references ledger.debts(id) on delete cascade,
  amount            numeric(12,2) not null,
  paid_at           date not null,
  principal_portion numeric(12,2) not null,
  interest_portion  numeric(12,2) not null,
  source            text not null default 'manual' check (source in ('manual','lunchmoney'))
);
create index if not exists debt_payments_debt_idx on ledger.debt_payments (debt_id, paid_at);

alter table ledger.bills
  drop constraint if exists bills_links_to_debt_fk,
  add  constraint bills_links_to_debt_fk
  foreign key (links_to_debt_id) references ledger.debts(id) on delete set null;

-- ---------------------------------------------------------------- events

-- Append-only, feeds the future game layer. The dashboard never reads it.
create table if not exists ledger.events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,
  occurred_at timestamptz not null default now(),
  payload     jsonb not null default '{}'::jsonb
);
create index if not exists events_user_idx on ledger.events (user_id, occurred_at desc);
