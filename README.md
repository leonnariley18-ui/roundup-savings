# Lunch Money Savings Toolkit

This repository holds two things that share a Lunch Money account:

- **Ledger** — the dashboard. A static site at the repository root, backed by
  Supabase. Setup and current status: **[SETUP.md](SETUP.md)**.
- **The Python email tools** — documented below, and unaffected by the
  dashboard. The Wednesday pre-payday sweep keeps running as it always has.

---

## The Python tools

A small set of Python tools that talk to your Lunch Money account and email
you beautifully formatted, actionable savings prompts. Built for someone who
budgets in batches, gets paid on Thursdays, and wants to build a quiet
micro-saving habit alongside paying down debt.

All tools run on GitHub Actions (free) and email via Gmail.

---

## What's in here

### 1. Round-up digest (`roundup.py`)
**Triggered manually**, after you finish categorizing transactions in Lunch
Money. You pick a date range, and the tool pulls all your categorized
transactions in the round-up categories (restaurants, food delivery, bars,
rideshare, transit), rounds each up to the next dollar, and emails you a
beautifully formatted digest with the total to move to your emergency fund.

### 2. Pre-payday sweep (`sweep.py`)
**Runs automatically every Wednesday at 7pm ET** (also manually triggerable).
Reads your current checking balance from Lunch Money and emails you the
amount to sweep into your emergency fund before Thursday's paycheck hits.

### 3. List my Lunch Money accounts (`list_accounts.py`)
**One-time helper**, used during setup. Lists all your Lunch Money accounts
with their IDs so you can find your checking account and plug its ID into
`sweep.py`.

---

## What the emails look like

Dark mode, money-green accents, clean typography. Hero number front and
center, breakdowns by category and by day, a final action card reminding you
to transfer the money and move the email to your Budgeting folder when you
do.

The sub-$1 days are collapsed into a footnote so the daily breakdown stays
scannable even across long date ranges.

---

## One-time setup

### 1. Lunch Money API token
Lunch Money → **Settings → Developers** → **Request new access token**.
Copy it (you can't see it again after closing the dialog).

### 2. Gmail app password
- Make sure 2-Step Verification is on for your Google account.
- Visit https://myaccount.google.com/apppasswords (search "Gmail app
  password" if the URL 404s — Google occasionally moves the page).
- Create a password, name it `round-up`. Copy the 16 characters.

### 3. Add three secrets to your GitHub repo
**Settings → Secrets and variables → Actions → New repository secret**:

| Name                  | Value                            |
| --------------------- | -------------------------------- |
| `LUNCHMONEY_TOKEN`    | the token from step 1            |
| `GMAIL_ADDRESS`       | your Gmail address               |
| `GMAIL_APP_PASSWORD`  | the 16-char app password         |

### 4. Find your checking account ID
- Actions → **List my Lunch Money accounts** → **Run workflow**
- Wait ~30 seconds, click into the run → click the **list** job → expand
  the **Run python list_accounts.py** step.
- Find your checking account in the output. Copy the `ID:` number.
- Note whether it was under "Plaid-connected" or "Manually managed".

### 5. Configure the sweep tool
Edit `sweep.py` in GitHub's web editor. Near the top:

```python
CHECKING_ACCOUNT_ID = None         # set to your ID, e.g. 12345
CHECKING_ACCOUNT_SOURCE = "plaid"   # or "asset" if manually managed
ZERO_OUT_BUFFER = 0.0               # dollars to leave behind, 0 = sweep all
```

Commit your changes.

### 6. Test both tools manually
- Actions → **Round-up digest** → Run workflow with a date range that has
  some categorized transactions → email should arrive within ~60 seconds.
- Actions → **Pre-payday sweep** → Run workflow → email should arrive.

If both emails land, you're done. Sweep will now run automatically every
Wednesday at 7pm ET.

---

## How to use it

### After a budgeting session
1. Categorize your transactions in Lunch Money.
2. Actions → **Round-up digest** → Run workflow.
3. Optionally fill in start/end dates (`YYYY-MM-DD`). Leave blank for "last
   30 days through today."
4. Email arrives. Transfer the amount. Move email to your **Budgeting**
   folder.

### Every Wednesday at 7pm ET
1. Pre-payday sweep email lands automatically.
2. Transfer the amount before payday hits Thursday morning.
3. Move email to your **Budgeting** folder.

The "move to Budgeting folder" step is your completion tracker. Inbox =
action pending. Folder = done.

---

## Configuration knobs

All near the top of `roundup.py` and `sweep.py`:

| Variable | File | What it does |
| -------- | ---- | ------------ |
| `ROUNDUP_KEYWORDS` | `roundup.py` | Which Lunch Money categories get rounded up. Substring match against category names. |
| `COLLAPSE_DAYS_UNDER` | `roundup.py` | Threshold for collapsing low-save days in the email. Default: $1.00. |
| `CHECKING_ACCOUNT_ID` | `sweep.py` | Your checking account's Lunch Money ID. |
| `CHECKING_ACCOUNT_SOURCE` | `sweep.py` | `"plaid"` or `"asset"`. |
| `ZERO_OUT_BUFFER` | `sweep.py` | Dollars to leave in checking after sweep. Default: $0. |

### Categories currently rounded up
- Restaurants
- Food Delivery
- Alcohol, Bars
- Rideshare, Taxi
- Public Transit
- (anything else whose category name contains: `restaurant`, `dining`,
  `food delivery`, `alcohol`, `bar`, `rideshare`, `taxi`, `uber`, `lyft`,
  `transit`, `subway`)

To add or remove, edit `ROUNDUP_KEYWORDS` at the top of `roundup.py`.

### Categories intentionally NOT rounded up
- **Groceries** — necessity, large infrequent transactions, round-ups feel
  meaningless on a $142 grocery run.
- **Subscription services** — predictable monthly charges, not discretionary
  spending decisions.
- **Pay later plans** — installment payments, round-ups don't fire usefully.

---

## Schedule

- **Round-up digest:** manual only. You trigger it when you've finished
  categorizing.
- **Pre-payday sweep:** automatic every Wednesday at 23:00 UTC (7pm ET
  during EDT, 6pm ET during EST — GitHub cron doesn't adjust for DST).
  Can also be triggered manually anytime.
- **List accounts:** manual only.

---

## Files

```
roundup-savings/
├── README.md
├── roundup.py              # round-up digest tool
├── sweep.py                # pre-payday sweep tool
├── list_accounts.py        # one-time setup helper
└── .github/
    └── workflows/
        ├── daily.yml          # workflow for roundup.py
        ├── sweep.yml          # workflow for sweep.py
        └── list_accounts.yml  # workflow for list_accounts.py
```

---

## Version history

### v1.0 — initial deploy
- Daily scheduled run with end-of-week digest email
- Plain text email format
- Restaurants only

### v1.1 — workflow rethink
- Realized the daily-then-Wednesday model didn't match the actual
  human budgeting workflow (categorize in batches, not daily)
- Rebuilt as fully manual: trigger after you finish categorizing
- Added user-selected start/end date inputs

### v1.2 — expanded categories + automated sweep
- Added: food delivery, alcohol/bars, rideshare/taxi, public transit
- Pre-payday sweep moved from "bundled into digest" to standalone tool
- Sweep set to auto-run every Wednesday at 7pm ET

### v1.5 — beautiful HTML emails (current)
- Replaced plain text with dark mode HTML design
- Money-green accent, large hero number, clean typography
- Sub-$1 days collapsed into a footnote
- Closer prompts moving to Budgeting folder for completion tracking
- Matching design for both round-up digest and pre-payday sweep
- Plaintext fallback for HTML-averse clients

---

## What's next

These are the planned future tools and improvements, roughly in priority
order. Each is independently designed; we'll tackle them one at a time so
the system never gets overwhelming.

### v2.0 — bills due this week (next up)
A Thursday-morning email that reads your **manually-set** recurring items
from Lunch Money (not auto-detected ones) and shows what's coming out this
week. Arrives right after payday so bill-paying flows naturally from the
deposit.

Decisions to make when we build this:
- Combine with paycheck info? "After bills, you'll have $X left"
- Thursday morning vs Wednesday evening (combined with sweep)?

### v2.5 — debt strategy integration
Once you've organized your debt info (totals, APRs, minimums), reroute the
swept money based on a strategy. Possible directions:
- All round-ups → highest-APR debt (avalanche)
- Round-ups split: some to emergency fund, some to debt
- Toggle destination based on whether you've hit your $1k starter fund

The email copy would change to reflect the destination: *"Move $X to Chase
Sapphire"* instead of *"Move $X to emergency fund."*

### v3.0 — running totals + completion tracking (Supabase)
Add a tiny Supabase backend that tracks confirmed transfers. The email gets
a "Mark transferred" button that hits a Supabase Edge Function. Future
emails then show:
- "You've moved $127 to savings since you started"
- "$45 round-ups pending across 2 unconfirmed weeks"
- Auto-nudge if you don't confirm within 3 days

This unlocks real momentum visualization. The folder-move workflow is good
enough for v1.5 but breaks down once we want to show trends over time.

### Other ideas in the parking lot
- **Monthly "where did it actually go" review** — first of every month,
  emails last month's totals by category. Good zoom-out for a weekly
  budgeter.
- **Subscription audit** — quarterly, scans the last 90 days for recurring
  charges and lists them so you can spot zombie subscriptions.
- **Spending streak tracker** — light gamification ("3 no-restaurant days
  in a row, best streak this month: 5"). Could fold into the round-up
  digest.
- **Budget pacing email** — Monday morning: "you're 67% through May and
  spent 82% of your restaurant budget."
- **Tiny web UI for date selection** — replaces the GitHub Actions text
  inputs with a real date picker, triggers workflows via GitHub's API.
  Nice-to-have once we have other reasons to build a web frontend
  (Supabase tracking page, etc).

---

## Troubleshooting

### "No matching categories found"
Check that your Lunch Money category names contain at least one of the
keywords in `ROUNDUP_KEYWORDS` at the top of `roundup.py`. The match is
case-insensitive substring (e.g., `"restaurant"` matches `"Restaurants &
Cafes"`).

### Round-up email shows `no_transactions` for days you definitely ate out
Likely cause: those transactions aren't categorized in Lunch Money yet.
Categorize them and re-run the workflow. The email will tell you the count
of uncategorized transactions in the FYI footer.

### Sweep email shows wrong balance
Lunch Money's Plaid balances are background-synced, not real-time. The
script triggers a fresh sync and waits 8 seconds, but it's not guaranteed.
If a balance looks wrong, open Lunch Money on your phone, pull-to-refresh,
then manually re-run the sweep workflow.

### Wednesday sweep email didn't arrive
GitHub sometimes delays the first scheduled run on a new cron schedule by
up to an hour. After the first successful run, it tends to be punctual. If
it's still missing by 8pm ET Wednesday, manually trigger once to confirm
the script works, then trust the schedule from there.

### Email arrived but looks like plain text (no styling)
Some Gmail clients (especially older mobile apps) prefer the plaintext
alternative. Open the email in Gmail web or the modern Gmail mobile app
and you'll see the HTML version.

---

## Tech notes

- **Stack:** Python 3.11 + `requests` library, GitHub Actions for
  scheduling, Gmail SMTP for sending.
- **Cost:** Free. GitHub Actions free tier covers this easily; Gmail is
  free; Lunch Money you already pay for.
- **Security:** All secrets stored as GitHub Actions secrets, never in
  code. The repo should be **private**. Your Lunch Money API token can
  read all your financial data, so treat it like a password.
- **Data:** No data is stored persistently outside Lunch Money. The tools
  query → compute → email → forget. No logs, no databases, no caches.
