"""
Lunch Money round-up digest — manual trigger version.

Triggered by you (via GitHub Actions UI) after you finish categorizing
transactions in Lunch Money. Pulls transactions in your chosen date range
that fall into your round-up categories, computes the round-up-to-the-dollar
savings total, and emails you a clean digest.

No schedule, no log file, no "pending" logic — you're the source of truth
for when categorization is done.

Required environment variables (set as GitHub secrets):
  LUNCHMONEY_TOKEN    - your Lunch Money API token
  GMAIL_ADDRESS       - your Gmail address (sender + recipient)
  GMAIL_APP_PASSWORD  - 16-character app password from Google

Optional inputs (passed from the GitHub Actions form):
  START_DATE   - YYYY-MM-DD (defaults to 30 days ago)
  END_DATE     - YYYY-MM-DD (defaults to today)
"""

import os
import math
import smtplib
import datetime
from collections import defaultdict
from email.message import EmailMessage

import requests

# --- config ---------------------------------------------------------------

LM_TOKEN = os.environ["LUNCHMONEY_TOKEN"]
GMAIL_ADDRESS = os.environ["GMAIL_ADDRESS"]
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]

# Category names to round up. Case-insensitive substring match against your
# Lunch Money category names. Edit this list to add or remove categories.
ROUNDUP_KEYWORDS = [
    "restaurant",       # matches "Restaurants", "Restaurants & Cafes", etc.
    "dining",
    "food delivery",
    "alcohol",
    "bar",              # matches "Bars", "Bars & Nightlife", etc.
    "rideshare",
    "taxi",
    "uber",
    "lyft",
    "transit",          # matches "Public Transit"
    "subway",
]

LM_BASE = "https://dev.lunchmoney.app/v1"
HEADERS = {"Authorization": f"Bearer {LM_TOKEN}"}


# --- Lunch Money API -----------------------------------------------------

def get_matching_categories():
    """Return dict {category_id: category_name} for all matching categories."""
    resp = requests.get(f"{LM_BASE}/categories", headers=HEADERS)
    resp.raise_for_status()
    matched = {}
    for cat in resp.json().get("categories", []):
        name = cat.get("name", "")
        name_lower = name.lower()
        if any(kw in name_lower for kw in ROUNDUP_KEYWORDS):
            matched[cat["id"]] = name
    return matched


def get_transactions(start_date, end_date):
    """Fetch all transactions in the given date range (inclusive)."""
    params = {"start_date": start_date, "end_date": end_date}
    resp = requests.get(f"{LM_BASE}/transactions", headers=HEADERS, params=params)
    resp.raise_for_status()
    return resp.json().get("transactions", [])


# --- the math ------------------------------------------------------------

def process(transactions, matched_categories):
    """
    Returns a dict with:
      - included: list of {date, payee, category, amount, rounded, diff}
      - skipped_uncategorized: count of uncategorized transactions
      - skipped_negative: count of refunds / income within these categories
      - by_day: {date: {spend, save, count}}
      - by_category: {category_name: {spend, save, count}}
      - totals: {spend, save, count}
    """
    included = []
    skipped_uncategorized = 0
    skipped_negative = 0

    by_day = defaultdict(lambda: {"spend": 0.0, "save": 0.0, "count": 0})
    by_category = defaultdict(lambda: {"spend": 0.0, "save": 0.0, "count": 0})

    for t in transactions:
        cat_id = t.get("category_id")
        amt = float(t.get("amount", 0))

        # Track uncategorized for FYI in the email.
        if cat_id is None:
            skipped_uncategorized += 1
            continue

        # Only round-up categories.
        if cat_id not in matched_categories:
            continue

        # Skip refunds / negative amounts (in Lunch Money, expenses are positive).
        if amt <= 0:
            skipped_negative += 1
            continue

        rounded = math.ceil(amt)
        diff = rounded - amt
        cat_name = matched_categories[cat_id]
        date = t.get("date", "?")
        payee = t.get("payee", "?")

        included.append({
            "date": date,
            "payee": payee,
            "category": cat_name,
            "amount": amt,
            "rounded": rounded,
            "diff": diff,
        })

        by_day[date]["spend"] += amt
        by_day[date]["save"] += diff
        by_day[date]["count"] += 1

        by_category[cat_name]["spend"] += amt
        by_category[cat_name]["save"] += diff
        by_category[cat_name]["count"] += 1

    totals = {
        "spend": sum(d["spend"] for d in by_day.values()),
        "save": sum(d["save"] for d in by_day.values()),
        "count": sum(d["count"] for d in by_day.values()),
    }

    return {
        "included": included,
        "skipped_uncategorized": skipped_uncategorized,
        "skipped_negative": skipped_negative,
        "by_day": dict(by_day),
        "by_category": dict(by_category),
        "totals": totals,
    }


# --- email ---------------------------------------------------------------

def format_email(result, start_date, end_date):
    """Returns (subject, body)."""
    totals = result["totals"]
    save = totals["save"]

    subject = f"Move ${save:.2f} to emergency fund ({start_date} \u2192 {end_date})"

    lines = [
        f"Round-up digest for {start_date} through {end_date}",
        "",
        "=" * 50,
        f"MOVE TO EMERGENCY FUND: ${save:.2f}",
        "=" * 50,
        "",
    ]

    if totals["count"] == 0:
        lines.append("No round-up-eligible transactions found in this date range.")
        if result["skipped_uncategorized"] > 0:
            lines.append(
                f"\n(Heads up: {result['skipped_uncategorized']} uncategorized "
                f"transaction(s) in this range \u2014 categorize them and re-run to include them.)"
            )
        return subject, "\n".join(lines)

    lines.append(f"Total spent: ${totals['spend']:.2f} across {totals['count']} transactions")
    lines.append("")

    # By-category summary.
    lines.append("--- BY CATEGORY ---")
    for cat, info in sorted(result["by_category"].items(), key=lambda x: -x[1]["save"]):
        lines.append(
            f"  {cat}: ${info['spend']:.2f} spent  \u2192  ${info['save']:.2f} saved  ({info['count']} tx)"
        )
    lines.append("")

    # By-day breakdown.
    lines.append("--- BY DAY ---")
    for date in sorted(result["by_day"].keys()):
        info = result["by_day"][date]
        day_label = datetime.date.fromisoformat(date).strftime("%a %b %-d")
        lines.append(
            f"  {day_label}: ${info['spend']:.2f}  \u2192  save ${info['save']:.2f}  ({info['count']} tx)"
        )

    # FYI footers.
    if result["skipped_uncategorized"] > 0:
        lines += [
            "",
            f"FYI: {result['skipped_uncategorized']} uncategorized transaction(s) in this range",
            "     were skipped. Categorize them and re-run to include them.",
        ]
    if result["skipped_negative"] > 0:
        lines += [
            "",
            f"FYI: {result['skipped_negative']} refund(s) / negative amount(s) skipped.",
        ]

    return subject, "\n".join(lines)


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

def get_date_range():
    """Read date range from env vars set by the workflow inputs."""
    end_date = os.environ.get("END_DATE", "").strip()
    start_date = os.environ.get("START_DATE", "").strip()

    today = datetime.date.today()
    if not end_date:
        end_date = today.isoformat()
    if not start_date:
        start_date = (today - datetime.timedelta(days=30)).isoformat()

    # Validate.
    try:
        datetime.date.fromisoformat(start_date)
        datetime.date.fromisoformat(end_date)
    except ValueError:
        raise SystemExit(
            f"Invalid date(s). Got start={start_date}, end={end_date}. "
            "Use YYYY-MM-DD format."
        )

    return start_date, end_date


def main():
    start_date, end_date = get_date_range()
    print(f"Processing transactions from {start_date} through {end_date}")

    matched_categories = get_matching_categories()
    if not matched_categories:
        raise SystemExit(
            "No matching categories found. Check your category names in Lunch Money "
            "against the ROUNDUP_KEYWORDS list at the top of roundup.py."
        )
    print(f"Matched {len(matched_categories)} categories: {list(matched_categories.values())}")

    transactions = get_transactions(start_date, end_date)
    print(f"Fetched {len(transactions)} total transactions in range")

    result = process(transactions, matched_categories)
    print(f"Included {result['totals']['count']} transactions, total save: ${result['totals']['save']:.2f}")

    subject, body = format_email(result, start_date, end_date)
    send_email(subject, body)
    print(f"Email sent: {subject}")


if __name__ == "__main__":
    main()
