# Lunch Money round-up + zero-out savings notifier

A small Python script that runs daily via GitHub Actions, quietly tracks
your restaurant round-up totals, and emails you **once a week on Wednesday
evening** with two numbers to move to savings:

1. **Round-up savings** — pennies and dollars rounded up from each restaurant
   transaction across the past 7 days.
2. **Zero-out sweep** — your current checking balance, ready to be swept to
   savings right before payday hits Thursday morning.

Designed to land in your inbox before your weekly budgeting session.

## What an email looks like

> **Subject:** Move $87.30 to savings ($24.30 round-up + $63.00 sweep)

```
Weekly money move — Wed May 20, 2026

--- ROUND-UP SAVINGS (week of May 13–19) ---

  Wed May 13:  spent $32.10  →  save $1.90  (3 tx)
  Thu May 14:  spent $18.45  →  save $0.55  (1 tx)
  Fri May 15:  spent $54.20  →  save $1.80  (4 tx)
  ...

  Restaurant spend: $287.40
  Round-up savings: $24.30

--- ZERO-OUT SWEEP ---

  Chase Checking balance: $63.00
  Sweep to savings: $63.00
  (balance last synced: 2026-05-20T22:14:00Z)

========================================
TOTAL TO MOVE TO SAVINGS: $87.30
========================================
```

## How it works

- **Daily (silent):** every evening, the script checks the past 5 days of
  restaurant transactions. Any day where all transactions have cleared
  gets its round-up recorded. Pending days are retried tomorrow.
- **Wednesday evening:** the script also asks Lunch Money to refresh its
  Plaid sync, reads your checking balance, and sends one email combining
  the week's round-up total with the zero-out sweep amount.
- **Never double-counts.** Once a day is recorded it's done; once a
  Wednesday digest is sent it won't resend.

## One-time setup

### 1. Lunch Money API token
Lunch Money → **Settings → Developers** → **Request new access token**.
Copy it — you can't see it again after closing the dialog.

### 2. Gmail app password
- Make sure 2-Step Verification is on for your Google account.
- Visit https://myaccount.google.com/apppasswords (if the URL 404s,
  search "Gmail app password").
- Create one, name it "round-up". Copy the 16 characters.

### 3. Private GitHub repo
- Create a private repo.
- Upload these four files (drag-drop in the web UI):
  - `roundup.py`
  - `list_accounts.py`
  - `.github/workflows/daily.yml`
  - `.github/workflows/list_accounts.yml`
  - `README.md`

### 4. Add three secrets
In your repo: **Settings → Secrets and variables → Actions → New
repository secret**. Add:

| Name                  | Value                                |
| --------------------- | ------------------------------------ |
| `LUNCHMONEY_TOKEN`    | the token from step 1                |
| `GMAIL_ADDRESS`       | your Gmail address                   |
| `GMAIL_APP_PASSWORD`  | the 16-char app password             |

### 5. Find your checking account ID
This is the only setup step specific to the zero-out feature.

- Go to **Actions → "List my Lunch Money accounts" → Run workflow**.
- Wait ~30 seconds, click into the run.
- Open the "Run python list_accounts.py" step. You'll see a list like:

  ```
  === Plaid-connected accounts ===

    ID: 12345
    Name: Plaid Checking  (Chase Checking)
    Type: depository / subtype: checking
    Institution: Chase
    Balance: 124.55 USD
    ...
  ```

- Find your spending/checking account. Copy its ID number.

### 6. Plug the account ID into the script
Open `roundup.py` in GitHub's web editor. Near the top, find:

```python
CHECKING_ACCOUNT_ID = None
CHECKING_ACCOUNT_SOURCE = "plaid"
ZERO_OUT_BUFFER = 0.0
```

Set `CHECKING_ACCOUNT_ID` to the number you found. Leave
`CHECKING_ACCOUNT_SOURCE = "plaid"` for bank-linked accounts, or
change to `"asset"` if it was in the "Manually managed assets"
section. `ZERO_OUT_BUFFER = 0.0` sweeps everything (your choice).
Commit.

### 7. Test it
- Go to **Actions → "Round-up tracker" → Run workflow**.
- Wait ~30 seconds. Click the run.

On a non-Wednesday: you'll see days being recorded silently, no email.
On Wednesday: you should get the digest email within a minute.

To test the email path immediately, temporarily change `DIGEST_WEEKDAY`
in `roundup.py` to today's weekday number (Monday=0 ... Sunday=6),
commit, run the workflow manually, then change it back to `2`.

## Tweaking it

- **Buffer:** want to leave money in checking? Set
  `ZERO_OUT_BUFFER = 50.0` (or any amount) in `roundup.py`.
- **Digest day:** change `DIGEST_WEEKDAY`.
- **Schedule time:** change the `cron` in `.github/workflows/daily.yml`.
  Currently 23:00 UTC ≈ 7pm ET (EDT) / 6pm ET (EST).
  [crontab.guru](https://crontab.guru) helps.
- **Category matching:** edit `RESTAURANT_KEYWORDS` if your Lunch Money
  categories use different names.
- **Lookback window:** raise `LOOKBACK_DAYS` if transactions sometimes
  take more than 5 days to clear.

## A note about balance freshness

The script asks Lunch Money to trigger a fresh Plaid sync before reading
the balance, then waits 8 seconds. Plaid syncs are a background job
though — there's no guarantee the balance is sub-minute fresh. The email
shows the `last synced` timestamp so you can see how old the number is.

If you ever see a balance that looks off, open the Lunch Money app and
pull-to-refresh, then trigger a workflow re-run.

## What's NOT in v1

- No "I moved the money" confirm-link tracking. The Wednesday email
  shows what to move; you still actually move it in your banking app.
- No actual money movement. Most banks don't expose a friendly transfer
  API to consumer scripts.
