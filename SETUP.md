# Ledger — setup

One pass, about fifteen minutes. At the end you have a live site at
`https://leonnariley18-ui.github.io/roundup-savings/` signed in against a
Supabase project — new or one you already have — with the six cards and the
loan seeded.

Steps 1–4 are the database, step 5 connects the site to it, step 6 publishes.
Step 7 is Lunch Money, and is only needed for Round-up and Bills.
The site is deliberately usable before any of this — it renders the shell and
says it is not connected — so you can do step 6 first if you want to see
something live immediately.

---

## 1. Pick a project

**You do not need a new Supabase project.** Ledger installs into its own
`ledger` schema, so it can live inside a project that already runs another
app without touching it. Given the free plan allows two active projects, and
paused projects break the apps that depend on them, sharing an existing one is
usually the right answer.

Sharing has a second advantage: a project kept awake by a live app never
auto-pauses, so the dashboard is never waiting on an unpause either.

If you do have a spare slot and would rather keep things separate, create a new
project instead — nothing below changes.

**What sharing does and does not mean:**

- **Your app's tables are untouched.** Everything here is created in `ledger`,
  never in `public`. Nothing in these migrations reads, alters, grants or
  revokes anything outside that schema.
- **Name collisions cannot happen.** A `ledger.cards` and a `public.cards` are
  different tables and coexist happily.
- **The user pool is shared.** Both apps authenticate against the same
  `auth.users`. That is safe — every Ledger row is scoped to your `auth.uid()`,
  so another user of your other app sees zero rows here — but it does mean you
  either reuse your existing account or add a second one.
- **Removing it later is one line:** `drop schema ledger cascade;`

### Living alongside your other app

Isolation runs both ways, but not perfectly, and the exceptions are worth
knowing before you go tinkering.

**The rule of thumb:** if its name does not start with `ledger.`, it is not
Ledger's. Everything this app owns is in that one schema.

**Cannot affect Ledger at all** — creating, altering, renaming or dropping
tables in `public`; editing any row in your app's tables; changing RLS policies
on them; adding columns or indexes; restoring a backup of an individual `public`
table. Different schema, no overlap.

**Can affect Ledger.** The short list, worst first:

| Action | Effect |
| --- | --- |
| **Deleting your user** in Authentication → Users | **Deletes every Ledger row you own.** Foreign keys cascade from `auth.users` by design, so the data goes with the account. |
| Restoring a **whole-project** backup from before Ledger was installed | The `ledger` schema disappears with everything in it |
| Removing `ledger` from **Exposed schemas** | Dashboard breaks. Data is fine; re-add it and it works |
| Rotating the **anon key** or JWT secret | Sign-ins fail until `config.js` is updated |
| Disabling the **email** auth provider | You cannot sign in |
| `drop schema ledger cascade` | Removes Ledger entirely — that is what it is for |

Only the first two lose data, and both are deliberate acts rather than
something you drift into. Everything else is a broken connection you can undo.

### The other app's requirements

This project (`pukzhmhevjbfwvhjzppr`) also runs **cLOUD** (`the-cloud-V2`), which
is in daily use. It authenticates unusually and its constraints are recorded
here so they are not rediscovered by breaking them.

cLOUD has **no login and no session**. It uses the publishable key plus a
hardcoded `user_id`, reads and writes one row of `public.cloud_data`, and
depends entirely on an RLS policy `"anon can access own row"` — PERMISSIVE,
`TO anon`, `FOR ALL`. Do not "fix" any of that.

Do not, without checking first:

1. **Rotate or disable API keys**, including migrating key generations. Enabling
   the new key system revoked the legacy JWT key and took cLOUD offline once.
2. **Touch `public.cloud_data`** — the table, its RLS, or that policy.
3. **Add RESTRICTIVE policies.** They AND with permissive ones, so a broad
   restrictive policy silently blocks anon everywhere. Ledger's are all
   permissive and scoped to `ledger.*`.
4. **Remove `public` from Exposed schemas.** It must stay.
5. **Create a table named `cloud_data`** in any schema — it would shadow the
   real one in PostgREST.

Ledger complies with all of it: nothing outside `ledger` is referenced, `anon`
is never granted anything, and no table name collides with `app_data`,
`cloud_data`, `cloud_data_backup_*` or `users`.

**Two apps, one origin.** Both are served from `leonnariley18-ui.github.io`, so
they share `localStorage`. supabase-js keys its stored session on the project
ref alone, which means both would use one slot and signing into one would
overwrite the other's session — and an app that picks up a foreign session
sends authenticated requests, which a `TO anon` policy refuses. That is not
hypothetical; it blanked cLOUD once. Ledger therefore sets an explicit
`storageKey` in `assets/js/db.js`. Leave it set.

**After any auth, API or RLS change, confirm cLOUD still reads:**

```sql
begin;
  set local role anon;
  select count(*) from public.cloud_data
  where user_id = 'dba87fdb-af33-4f2f-94a6-6ee8e6a5c104'::uuid;
rollback;
```

Expect `1`. A `0` means something took anon's access away.

**Worth doing given you keep backup tables around:** Ledger's data is small, so
export it occasionally. In the SQL editor, run a `select *` against any
`ledger.` table and use the download button, or ask a database client for
`pg_dump --schema=ledger`. A single dated export is enough to rebuild from.

## 2. Run the migrations

Open **SQL Editor** in the left sidebar. Run these three files **in order**,
pasting the contents of each into a new query and hitting Run:

| Order | File | What it does |
| --- | --- | --- |
| 1 | `supabase/migrations/0001_schema.sql` | Creates the `ledger` schema and every table |
| 2 | `supabase/migrations/0002_rls.sql` | Row level security |
| 3 | `supabase/migrations/0003_seed.sql` | Defines the seed function — does not run it yet |

Each should report success. Order matters: RLS refers to the tables, and the
seed refers to both.

### Expose the schema

**Settings → API → Exposed schemas.** Add **`ledger`** to the list and save.

PostgREST only serves schemas named here, so without this the site connects and
authenticates fine but every query returns a "schema must be one of the
following" error. It is the one step with no visible symptom until you try to
load data.

## 3. Get an account

Ledger has no sign-up form, so the account is either one you already have or
one you make by hand.

**If you are sharing a project and already have an account in it**, just use
that — nothing to do here. Your Ledger rows are scoped to that user id.

**To add a separate account:**

1. **Authentication → Users → Add user → Create new user.**
2. Enter an email and password. **Tick "Auto Confirm User"** — without it
   Supabase waits on a confirmation email that is not configured yet, and the
   sign-in will fail with credentials that are actually correct.

### About public sign-ups

> **On a shared project, do not disable sign-ups.** If the other app in this
> project registers its own users, turning sign-ups off breaks it. This is the
> one setting where installing Ledger could damage a neighbouring app, and it
> is why it is called out rather than left as a default instruction.

On a **dedicated** project with nothing else in it, turning them off is worth
doing: **Authentication → Sign In / Providers → Email** → disable **"Allow new
users to sign up"**.

Either way your data is safe. The anon key is visible in the page source of a
public site — expected, and fine, because it grants nothing without a signed-in
user. If sign-ups stay open, a stranger can create their own account, but RLS
scopes every Ledger row to its owner, so they see nothing of yours. Closing
sign-ups removes a pointless door; it is not what is protecting you.

### Stay signed in

**Authentication → Sessions.** Leave **"Time-box user sessions"** and **"Inactivity
timeout"** both unset. They are empty by default; this is a check, not a change.

With those off, signing in once per browser is the whole of it. The session is
stored locally and renews itself in the background, so a device you have signed
in on stays signed in indefinitely — you should not see the gate again on it.

### If you ever get locked out

You cannot be permanently locked out of this, because you own the database. No
email has to arrive for any of it to work.

**To reset your own password:** Supabase dashboard → **Authentication → Users**
→ click your user → **Reset password**, and set a new one directly. It takes
about thirty seconds and involves no email at all.

This is worth knowing up front, because the usual way people get stranded in a
Supabase project is a confirmation email that never arrives: a new project has
no SMTP configured, and the built-in sender is rate-limited and unreliable. An
account then exists but reads as unconfirmed, correct passwords are rejected,
and the magic link meant to rescue you depends on the same dead email path.

This app avoids that by construction — it uses email and password rather than
magic links, and step 3 creates the account already confirmed, so nothing here
ever waits on an inbox. The dashboard reset above is the backstop regardless.

## 4. Seed the cards and the loan

Copy your new user's **UID** from the Users list, then run this in the SQL
editor with the UID pasted in:

```sql
select ledger.seed_ledger('paste-your-user-uid-here');
```

It reports what it wrote. It refuses to run twice, so a second run is harmless.

This seeds **only the six cards, their reward rows, and the SoFi loan**. Bills,
paybacks, statement closes, notes and round-up runs all start empty on purpose —
every screen has a real empty state that tells you what to do, which is more use
than a screen of invented data.

Wells Fargo's APR seeds as `null` rather than a placeholder, because it is
genuinely not known. The Statements tab will surface it as a gap to fill.

## 5. Connect the site

In Supabase: **Project Settings → API**. Copy the **Project URL** and the
**anon / public** key.

Open `assets/js/config.js` and fill in the two constants:

```js
export const SUPABASE_URL = 'https://xxxxxxxxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

Commit and push. Never put the **service_role** key here — it bypasses RLS
entirely. It is not needed by this app at all, and later on the Lunch Money
token belongs in Supabase secrets, reached only from Edge Functions.

## 6. Publish the site

In GitHub: **Settings → Pages**.

- **Source:** Deploy from a branch
- **Branch:** `main`, folder `/ (root)`

Save. The first build takes a minute or two, then the site is at
`https://leonnariley18-ui.github.io/roundup-savings/`.

The dashboard lives at the repository root and shares the repo with the existing
sweep tooling, which is untouched — `sweep.yml` keeps running the Wednesday
pre-payday email exactly as before.

If you are working on the `claude/new-dashboard-setup-g5o8sq` branch, either
merge it to `main` first or point Pages at that branch while you try it.

## 7. Lunch Money (steps 7 and 8 only)

Skip this until you want Round-up and Bills. Everything else works without it.

The Lunch Money token is a **real secret**, unlike the anon key. It lives in
Supabase secrets and is only ever read inside an Edge Function — there is
deliberately no path from the browser to Lunch Money.

### Set the secrets

**Project Settings → Edge Functions → Secrets.** Add three:

| Name | Value |
| --- | --- |
| `LUNCHMONEY_TOKEN` | Your token from [my.lunchmoney.app/developers](https://my.lunchmoney.app/developers) |
| `LEDGER_USER_ID` | Your Ledger user's UID — the same one you seeded with |
| `BILLS_FROM` | `2026-08-01`, or whenever bills should start |

`LEDGER_USER_ID` matters here more than it would on a dedicated project. A
valid JWT is not proof of identity when the project is shared with an app whose
sign-ups may be open — anyone with an account there presents one. Each function
checks the caller against this before spending the token or returning what it
fetched.

### Deploy the functions

**Edge Functions → Deploy a new function** in the dashboard, once per function.
No CLI needed.

| Function | Paste from |
| --- | --- |
| `calc-roundup` | `supabase/functions/calc-roundup/index.ts` |
| `sync-bills` | `supabase/functions/sync-bills/index.ts` |
| `sync-card-balances` | `supabase/functions/sync-card-balances/index.ts` |

Each imports `../_shared/lunchmoney.ts`. If the dashboard editor won't let you
add a second file, paste the contents of that shared file at the top of each
function and delete the import line — it is the same code either way.

### Then, in the app

- **Which card → Sync balances.** Cards are matched on their last four digits.
  Anything unmatched is named in the toast rather than silently skipped.
- **Calendar → Sync bills.** Pulls only recurring items you set by hand, not
  the ones Lunch Money infers, and generates nothing before `BILLS_FROM`.
- **Round-up → Recalculate.** Uses the same category keywords as `roundup.py`.

Re-running any of them is safe. Bills match on their Lunch Money id so they
never duplicate, and an instance you have already ticked or edited is never
overwritten.

### The old workflow

`daily.yml` still runs the Python round-up. Once the Round-up tab is doing what
you want, that workflow can be disabled — it is the same calculation by email.
**Leave `sweep.yml` alone**; the Wednesday pre-payday sweep is out of scope and
still useful.

## 8. Check it worked

Open the site. You should get the sign-in gate rather than the shell. Sign in
with the account from step 3.

If something is off, the message tells you which of three things happened:

| What you see | What it means |
| --- | --- |
| "Not connected to a database yet" | `config.js` is still empty — step 5 |
| A schema error mentioning `ledger` | `ledger` was not added to Exposed schemas — step 2 |
| "Could not load the Supabase client from the CDN" | Network, not configuration. Reload. |
| "Invalid login credentials" | Wrong password, or "Auto Confirm User" was not ticked in step 3. Either way the fix is the dashboard password reset above — never a magic link. |
| The gate appears again on a device you already signed in on | A session timeout is set. Check **Authentication → Sessions**. |

---

## Running the tests

No dependencies and no build step:

```sh
node --test tests/*.test.mjs
```

The two custom controls are pure interaction and are not covered by those. Open
`tests/components.html` in a browser to exercise them by hand — it is a bench,
not part of the app.

## What is built so far

This is the **foundation phase** of the build order in the spec.

Built and working: the schema, RLS, the seed, auth, the app shell — masthead,
drawer nav, tab routing, the loan modal mount — the design system carried over
from the prototype, and the two shared components everything else depends on.

Not built yet: all six screens. Each says so, and names where it sits in the
build order. Next is **step 3 — Which card and Statements**, which share one
statement-prediction function and need no Lunch Money data.
