"""
Lunch Money round-up + zero-out savings notifier.

Runs once a day. Every run it quietly tracks the past few days of cleared
restaurant transactions and records the round-up amount per day. On the
configured digest day (Wednesday), it emails one combined message:

  1. Round-up savings — sum of round-ups across the past 7 cleared days.
  2. Zero-out sweep   — the current balance of your checking account,
                        ready to be swept to savings before payday.

Required environment variables (set as GitHub secrets):
  LUNCHMONEY_TOKEN    - your Lunch Money API token
  GMAIL_ADDRESS       - your Gmail address (sender + recipient)
  GMAIL_APP_PASSWORD  - 16-character app password from Google
"""

import os
import json
import math
import time
import smtplib
import datetime
from email.message import EmailMessage
from pathlib import Path

import requests

# --- config ---------------------------------------------------------------

LM_TOKEN = os.environ["LUNCHMONEY_TOKEN"]
GMAIL_ADDRESS = os.environ["GMAIL_ADDRESS"]
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]

# Which category names count as "restaurants." Case-insensitive substring match.
RESTAURANT_KEYWORDS = ["restaurant", "dining", "food", "coffee", "eat"]

# Days of week: Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4,
# Saturday=5, Sunday=6.
DIGEST_WEEKDAY = 2  # Wednesday

# How far back the daily tracker looks each run.
LOOKBACK_DAYS = 5

# === ZERO-OUT CONFIG ====================================================
# Run list_accounts.py once to find these. Then fill them in here.
CHECKING_ACCOUNT_ID = None        # e.g. 12345
CHECKING_ACCOUNT_SOURCE = "plaid"  # "plaid" (bank-linked) or "asset" (manual)
ZERO_OUT_BUFFER = 0.0              # dollars to leave in checking after sweep
# =========================================================================

LOG_FILE = Path("processed_days.json")
LM_BASE = "https://dev.lunchmoney.app/v1"
HEADERS = {"Authorization": f"Bearer {LM_TOKEN}"}


# --- log file ------------------------------------------------------------

def load_log():
    if LOG_FILE.exists():
        return json.loads(LOG_FILE.read_text())
    return {"days": {}, "digests_sent": []}


def save_log(log):
    LOG_FILE.write_text(json.dumps(log, indent=2, sort_keys=True))


# --- Lunch Money: transactions & categories ------------------------------

def get_restaurant_category_ids():
    resp = requests.get(f"{LM_BASE}/categories", headers=HEADERS)
    resp.raise_for_status()
    categories = resp.json().get("categories", [])
    ids = []
    for cat in categories:
        name = cat.get("name", "").lower()
        if any(kw in name for kw in RESTAURANT_KEYWORDS):
            ids.append(cat["id"])
    return ids


def get_transactions_for_date(date_str):
    params = {"start_date": date_str, "end_date": date_str}
    resp = requests.get(f"{LM_BASE}/transactions", headers=HEADERS, params=params)
    resp.raise_for_status()
    return resp.json().get("transactions", [])


# --- Lunch Money: account balance (for zero-out) -------------------------

def trigger_plaid_refresh():
    """Ask Lunch Money to pull fresh data from Plaid. Best-effort."""
    try:
        requests.post(f"{LM_BASE}/plaid_accounts/fetch", headers=HEADERS, timeout=10)
    except Exception as e:
        print(f"  (plaid refresh request failed, will use existing balance: {e})")


def get_checking_account_info():
    """Return (balance, account_name, last_fetch_iso) or (None, None, None)."""
    if CHECKING_ACCOUNT_ID is None:
        return None, None, None

    if CHECKING_ACCOUNT_SOURCE == "plaid":
        resp = requests.get(f"{LM_BASE}/plaid_accounts", headers=HEADERS)
        resp.raise_for_status()
        for a in resp.json().get("plaid_accounts", []):
            if a["id"] == CHECKING_ACCOUNT_ID:
                return (
                    float(a.get("balance", 0)),
                    a.get("display_name") or a.get("name") or "Checking",
                    a.get("last_fetch"),
                )
    else:  # "asset"
        resp = requests.get(f"{LM_BASE}/assets", headers=HEADERS)
        resp.raise_for_status()
        for a in resp.json().get("assets", []):
            if a["id"] == CHECKING_ACCOUNT_ID:
                return (
                    float(a.get("balance", 0)),
                    a.get("display_name") or a.get("name") or "Checking",
                    None,  # manual assets have no last_fetch
                )

    return None, None, None


# --- daily tracking (silent) ---------------------------------------------

def record_day(date_str, restaurant_cat_ids, log):
    if date_str in log["days"]:
        return "already_recorded"

    all_tx = get_transactions_for_date(date_str)
    rest_tx = [
        t for t in all_tx
        if t.get("category_id") in restaurant_cat_ids
        and float(t.get("amount", 0)) > 0
    ]

    if not rest_tx:
        log["days"][date_str] = {"spend": 0.0, "save": 0.0, "count": 0}
        return "no_transactions"

    if any(t.get("status") == "uncleared" for t in rest_tx):
        return "pending"

    total_spend = sum(float(t["amount"]) for t in rest_tx)
    total_rounded = sum(math.ceil(float(t["amount"])) for t in rest_tx)
    save = total_rounded - total_spend

    log["days"][date_str] = {
        "spend": round(total_spend, 2),
        "save": round(save, 2),
        "count": len(rest_tx),
    }
    return "recorded"


# --- weekly digest -------------------------------------------------------

def build_roundup_section(log, today):
    """Return (subject_amount, body_lines, has_pending_warning)."""
    start = today - datetime.timedelta(days=7)
    end = today - datetime.timedelta(days=1)

    days_in_range = []
    for offset in range(7):
        d = (start + datetime.timedelta(days=offset)).isoformat()
        if d in log["days"]:
            days_in_range.append((d, log["days"][d]))

    total_save = sum(d[1]["save"] for d in days_in_range)
    total_spend = sum(d[1]["spend"] for d in days_in_range)
    spending_days = [d for d in days_in_range if d[1]["count"] > 0]

    start_label = start.strftime("%b %-d")
    end_label = end.strftime("%b %-d")
    date_range = f"{start_label}\u2013{end_label}"

    lines = [f"--- ROUND-UP SAVINGS (week of {date_range}) ---", ""]
    if not spending_days:
        lines.append("  No cleared restaurant transactions this week.")
    else:
        for d, info in spending_days:
            day_label = datetime.date.fromisoformat(d).strftime("%a %b %-d")
            lines.append(
                f"  {day_label}:  spent ${info['spend']:.2f}  "
                f"\u2192  save ${info['save']:.2f}  ({info['count']} tx)"
            )
        lines += [
            "",
            f"  Restaurant spend: ${total_spend:.2f}",
            f"  Round-up savings: ${total_save:.2f}",
        ]

    missing = []
    for offset in range(7):
        d = (start + datetime.timedelta(days=offset)).isoformat()
        if d not in log["days"]:
            missing.append(d)
    if missing:
        lines += [
            "",
            "  Heads up: these days still had pending charges and aren't included:",
        ] + [f"    {m}" for m in missing]

    return total_save, lines


def build_zeroout_section():
    """Return (sweep_amount, body_lines) or (0, lines explaining why we skipped)."""
    lines = ["--- ZERO-OUT SWEEP ---", ""]

    if CHECKING_ACCOUNT_ID is None:
        lines += [
            "  Skipped: CHECKING_ACCOUNT_ID not set in roundup.py.",
            "  Run list_accounts.py to find your account ID, then update config.",
        ]
        return 0.0, lines

    # Trigger a Plaid refresh, then wait a moment for it to land.
    if CHECKING_ACCOUNT_SOURCE == "plaid":
        trigger_plaid_refresh()
        time.sleep(8)  # give Plaid a few seconds; not a guarantee

    balance, name, last_fetch = get_checking_account_info()
    if balance is None:
        lines.append(f"  Couldn't find an account with ID {CHECKING_ACCOUNT_ID}.")
        return 0.0, lines

    sweep = max(0.0, balance - ZERO_OUT_BUFFER)

    lines.append(f"  {name} balance: ${balance:.2f}")
    if ZERO_OUT_BUFFER > 0:
        lines.append(f"  Buffer kept:    ${ZERO_OUT_BUFFER:.2f}")
    lines.append(f"  Sweep to savings: ${sweep:.2f}")

    if last_fetch:
        lines.append(f"  (balance last synced: {last_fetch})")

    return sweep, lines


def maybe_send_weekly_digest(log):
    today = datetime.date.today()
    if today.weekday() != DIGEST_WEEKDAY:
        return False

    today_key = today.isoformat()
    if today_key in log["digests_sent"]:
        return False

    roundup_amount, roundup_lines = build_roundup_section(log, today)
    sweep_amount, sweep_lines = build_zeroout_section()

    total = roundup_amount + sweep_amount

    body_lines = (
        [f"Weekly money move \u2014 {today.strftime('%a %b %-d, %Y')}", ""]
        + roundup_lines
        + [""]
        + sweep_lines
        + ["", "=" * 40, f"TOTAL TO MOVE TO SAVINGS: ${total:.2f}", "=" * 40]
    )

    subject = f"Move ${total:.2f} to savings (${roundup_amount:.2f} round-up + ${sweep_amount:.2f} sweep)"

    send_email(subject, "\n".join(body_lines))
    log["digests_sent"].append(today_key)
    return True


# --- email plumbing ------------------------------------------------------

def send_email(subject, body):
    msg = EmailMessage()
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = GMAIL_ADDRESS
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        s.send_message(msg)


# --- entrypoint ----------------------------------------------------------

def main():
    log = load_log()
    rest_ids = get_restaurant_category_ids()
    if not rest_ids:
        print("No restaurant-like categories found in Lunch Money. Check category names.")
        return

    today = datetime.date.today()
    for offset in range(LOOKBACK_DAYS, 0, -1):
        d = (today - datetime.timedelta(days=offset)).isoformat()
        result = record_day(d, rest_ids, log)
        print(f"{d}: {result}")

    sent = maybe_send_weekly_digest(log)
    print(f"Weekly digest sent: {sent}")

    save_log(log)


if __name__ == "__main__":
    main()
