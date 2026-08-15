-- Ledger — row level security
-- Run this second. See SETUP.md.
--
-- The anon key ships in the bundle on a public Pages site, so it is not a
-- secret and nothing may be reachable with it alone. Every table is scoped to
-- auth.uid(): without a signed-in session, auth.uid() is null, every policy
-- fails, and the API returns empty. That is the whole security model, which is
-- why it is one rule applied uniformly rather than fifteen hand-written ones —
-- a uniform rule can be verified by reading it once.
--
-- Everything below is confined to the `ledger` schema. This project may already
-- contain another application, and nothing here reads, alters, or revokes
-- anything outside its own schema. An earlier draft of this file ended with
-- `revoke all on all tables in schema public from anon`, which is reasonable
-- hardening on an empty project and capable of breaking a live app on a shared
-- one. Scoping is not a detail here — it is the difference between installing
-- this app and taking down another one.

-- Reachable through PostgREST only once 'ledger' is added to the exposed
-- schemas in Settings → API. Usage alone grants no access to any table.
grant usage on schema ledger to authenticated;

-- Same policy on every table: you may touch a row if it is yours, and you may
-- only write rows that are yours. `using` governs what is visible to read,
-- update and delete; `with check` governs what insert and update may produce.
do $$
declare t text;
begin
  foreach t in array array[
    'cards','card_rewards','card_choice_categories','card_decisions',
    'statement_closes','paybacks','payback_payments','bills','bill_instances',
    'notes','roundup_runs','debts','debt_payments'
  ] loop
    execute format('alter table ledger.%I enable row level security', t);
    execute format('alter table ledger.%I force row level security', t);
    execute format('grant select, insert, update, delete on ledger.%I to authenticated', t);
    execute format('drop policy if exists owner_all on ledger.%I', t);
    execute format(
      'create policy owner_all on ledger.%I for all
         to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- events is the exception: append-only. The game layer will read this history
-- and it has to be trustworthy, so there is deliberately no update or delete
-- policy — not even for the owner. Nothing can rewrite what already happened.
alter table ledger.events enable row level security;
alter table ledger.events force row level security;
grant select, insert on ledger.events to authenticated;

drop policy if exists owner_read on ledger.events;
create policy owner_read on ledger.events
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists owner_append on ledger.events;
create policy owner_append on ledger.events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Defaulting user_id means the client never sends it and cannot get it wrong.
-- The with-check above still enforces it — this is convenience, not the control.
do $$
declare t text;
begin
  foreach t in array array[
    'cards','card_rewards','card_choice_categories','card_decisions',
    'statement_closes','paybacks','payback_payments','bills','bill_instances',
    'notes','roundup_runs','debts','debt_payments','events'
  ] loop
    execute format('alter table ledger.%I alter column user_id set default auth.uid()', t);
  end loop;
end $$;

-- anon is granted nothing on this schema — not usage, not a single table — so
-- an unauthenticated request cannot reach any of it. Nothing is revoked from
-- anon either, because revoking is what would reach outside this schema and
-- touch a neighbouring app. Never granting is both safer and sufficient.
