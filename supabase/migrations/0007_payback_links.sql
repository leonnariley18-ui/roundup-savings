-- Ledger — mark paid, and linking a card decision to a payback
-- Run after 0006. Safe to re-run.
--
-- ---------------------------------------------------------------- mark paid
--
-- Once a payback is on the real statement there's no payment left to log
-- against it here — paying it means paying the card bill as a whole, and this
-- app has no way to verify a partial amount against one charge on that bill.
-- "Mark paid" records that it was settled that way without inventing a
-- payment figure. It needed its own status distinct from a real
-- fully-tracked clear, so the client can say "paid, via the statement"
-- rather than implying a payment history that was never logged.

alter table ledger.paybacks drop constraint if exists paybacks_status_check;
alter table ledger.paybacks add constraint paybacks_status_check
  check (status in ('open', 'cleared', 'became_bill', 'paid'));

-- ---------------------------------------------------------------- linking a decision

-- Which Card logs a decision at the moment you pick a card; Paybacks tracks
-- money you're fronting and need to pay back. They're separate concepts, but
-- sometimes the same purchase is both — "I put this on the best card" and
-- "I need to pay myself back for it." The link is optional and made after
-- the fact, from the payback's side; nothing here changes what logging a
-- card decision does on its own.
alter table ledger.card_decisions
  add column if not exists payback_id uuid references ledger.paybacks(id) on delete set null;

create index if not exists card_decisions_payback_idx on ledger.card_decisions (payback_id);
