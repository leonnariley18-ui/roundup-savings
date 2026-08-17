# Ledger

A calendar-first money dashboard for one person, because nearly everything it
tracks is a date problem: when a statement closes, when a bill lands, how many
days you have to clear something before it stops being optional.

**Live at** [leonnariley18-ui.github.io/roundup-savings](https://leonnariley18-ui.github.io/roundup-savings/)

Setup — database, auth, deployment, Lunch Money — is in **[SETUP.md](SETUP.md)**.

---

## What it does

**Calendar** — Monday-start grid with ISO week numbers. Statement closes,
payback deadlines, bills, reminders and round-ups all land here. Every day is
clickable, including empty ones and days outside the month, and notes live in
the day modal and nowhere else.

**Week view** — the same week as a sheet of cream paper. Bills tick off, amounts
edit inline, and the loan row opens the loan.

**Which card** — a pre-purchase decision tool. Pick a date, a category and
optionally an amount, and it says which card to use and *why*, in dollars and
days. Ranking derives from the date you scrub to, so the answer changes as
close dates pass.

**Statements** — log each real closing date as statements arrive. Cards flip to
confirmed individually once three consistent closes agree.

**Paybacks** — for putting something on a card meaning to clear it in days,
then forgetting. The countdown runs to **statement close**, not the payment due
date: clear it before close and it never becomes a bill at all.

**Bills** — entered by hand. Cadence, start, optional end, autopay, and a
funding reminder that appears a few days ahead and ticks off like a bill.

**Round-up** — rounds categorized spending up to the next dollar and totals the
difference. "I moved the money" records the date and the range swept, and
nothing else.

**The loan** — a modal, not a tab. Every figure computed from the terms and the
logged payments; nothing hardcoded.

---

## How it's built

Static site, no build step. Vanilla ES modules, served straight from the
repository root by GitHub Pages. Supabase for Postgres, auth and Edge Functions.

The one structural rule: **logic is separate from screens, and the logic has no
DOM and no database**. That is what makes it testable, and what will let a
mobile frontend sit on it without any of it being copied.

```
assets/js/
  dates.js        date maths, ISO weeks           ← pure
  statements.js   close-date prediction            ← pure
  ranking.js      which card to use                ← pure
  paybacks.js     payback state transitions        ← pure
  bills.js        recurrence, reminders, payday     ← pure
  loan.js         amortisation                      ← pure
  events.js       one event model for every date    ← pure
  data.js         every Supabase call
  db.js           the client
  screens/        the six screens + the loan modal
```

`events.js` matters more than its size suggests. Everything on a date comes
from one function in one shape — an earlier prototype built the grid markers,
the week list and the day modal separately and they drifted, so a marker could
appear with nothing behind it.

### Things that are deliberate

- **Nothing is predicted into the record.** `statement_closes` holds only dates
  you observed; the pattern is derived on every read. Deleting a mistyped one
  re-derives everything built on it.
- **Bill occurrences are derived, never generated ahead.** A bill entered today
  is on the calendar for 2031, and changing its cadence corrects every future
  date at once. `bill_instances` holds only what you have actually touched.
- **Autopay bills are never auto-ticked.** The tick records "I looked at it",
  not "the charge posted", and a failed autopay is the case most worth seeing.
- **Round-ups store no amount.** A tracker that only sees money going in drifts
  into fiction the first time you withdraw some. The amount lives in the bank.
- **The reschedule count is stored and never shown.** Surfacing it would turn a
  helpful affordance into a scold.

---

## Sharing a Supabase project

Ledger installs into its own `ledger` schema and shares a project with another
app. Nothing outside that schema is ever read, written, granted or revoked.
The constraints that keeps — and the reason `db.js` sets an explicit
`storageKey` — are documented in [SETUP.md](SETUP.md).

**The rule of thumb: if its name doesn't start with `ledger.`, it isn't ours.**

---

## Tests

No dependencies, no build step:

```sh
node --test tests/*.test.mjs
```

126 tests over the pure modules. `tests/components.html` is a bench for the
date picker and select, which are pure interaction and can't be unit tested.

Worth knowing: several of these encode findings that contradict the original
spec — the cost of one month at the loan's minimum, a cycle-length sanity check
that stops two mistyped dates becoming a confident 14-day billing cycle. Where
they disagree with a document, the comment says why.

---

## The Python tools

The repository also holds the email tooling that predates the dashboard.

- **`sweep.py`** — Wednesday pre-payday sweep email. Still running, still
  useful, deliberately out of scope for the dashboard.
- **`roundup.py`** — the original round-up digest. Superseded by the Round-up
  tab, which is a port of its maths. Its workflow can be disabled once you are
  happy with the tab.
- **`list_accounts.py`** — one-time setup helper.

These run on GitHub Actions and email via Gmail. They share a Lunch Money
account with the dashboard but nothing else.
