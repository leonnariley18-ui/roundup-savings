"""
Lunch Money round-up digest — manual trigger version.

Triggered by you (via GitHub Actions UI) after you finish categorizing
transactions in Lunch Money. Pulls transactions in your chosen date range
that fall into your round-up categories, computes the round-up-to-the-dollar
savings total, and emails you a clean HTML digest.

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
    "restaurant",
    "dining",
    "food delivery",
    "alcohol",
    "bar",
    "rideshare",
    "taxi",
    "uber",
    "lyft",
    "transit",
    "subway",
]

# Days with a save amount under this threshold get collapsed into a single
# footnote in the "by day" section so the list stays scannable.
COLLAPSE_DAYS_UNDER = 1.00

LM_BASE = "https://dev.lunchmoney.app/v1"
HEADERS = {"Authorization": f"Bearer {LM_TOKEN}"}


# --- Lunch Money API -----------------------------------------------------

def get_matching_categories():
    resp = requests.get(f"{LM_BASE}/categories", headers=HEADERS)
    resp.raise_for_status()
    matched = {}
    for cat in resp.json().get("categories", []):
        name = cat.get("name", "")
        if any(kw in name.lower() for kw in ROUNDUP_KEYWORDS):
            matched[cat["id"]] = name
    return matched


def get_transactions(start_date, end_date):
    params = {"start_date": start_date, "end_date": end_date}
    resp = requests.get(f"{LM_BASE}/transactions", headers=HEADERS, params=params)
    resp.raise_for_status()
    return resp.json().get("transactions", [])


# --- the math ------------------------------------------------------------

def process(transactions, matched_categories):
    included = []
    skipped_uncategorized = 0
    skipped_negative = 0

    by_day = defaultdict(lambda: {"spend": 0.0, "save": 0.0, "count": 0})
    by_category = defaultdict(lambda: {"spend": 0.0, "save": 0.0, "count": 0})

    for t in transactions:
        cat_id = t.get("category_id")
        amt = float(t.get("amount", 0))

        if cat_id is None:
            skipped_uncategorized += 1
            continue
        if cat_id not in matched_categories:
            continue
        if amt <= 0:
            skipped_negative += 1
            continue

        rounded = math.ceil(amt)
        diff = rounded - amt
        cat_name = matched_categories[cat_id]
        date = t.get("date", "?")

        included.append({"date": date, "amount": amt, "rounded": rounded, "diff": diff})

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
        "skipped_uncategorized": skipped_uncategorized,
        "skipped_negative": skipped_negative,
        "by_day": dict(by_day),
        "by_category": dict(by_category),
        "totals": totals,
    }


# --- email rendering -----------------------------------------------------

# Color palette (matches the approved preview)
BG_OUTER = "#1a1d1a"
BG_CARD = "#0f1410"
BG_INSET = "#142019"
DIVIDER = "#1f2a23"
ACCENT = "#34d399"
ACCENT_DARK = "#10b981"
TEXT_PRIMARY = "#e8efe9"
TEXT_SECONDARY = "#a8b3ab"
TEXT_TERTIARY = "#6b7770"
TEXT_QUATERNARY = "#4a544e"
FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"


def fmt_date_range(start_date, end_date):
    """e.g. 'Apr 1 – Apr 22, 2026'"""
    s = datetime.date.fromisoformat(start_date)
    e = datetime.date.fromisoformat(end_date)
    if s.year == e.year:
        return f"{s.strftime('%b %-d')} \u2013 {e.strftime('%b %-d, %Y')}"
    return f"{s.strftime('%b %-d, %Y')} \u2013 {e.strftime('%b %-d, %Y')}"


def render_category_row(name, info):
    return f"""
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:14px;">
        <tr>
          <td style="vertical-align:top;">
            <p style="margin:0 0 2px 0; color:{TEXT_PRIMARY}; font-size:15px; font-weight:500;">{name}</p>
            <p style="margin:0; color:{TEXT_TERTIARY}; font-size:12px;">{info['count']} transaction{'s' if info['count'] != 1 else ''} &middot; ${info['spend']:.2f} spent</p>
          </td>
          <td style="vertical-align:top; text-align:right; white-space:nowrap;">
            <p style="margin:0; color:{ACCENT}; font-size:17px; font-weight:600;">+${info['save']:.2f}</p>
          </td>
        </tr>
      </table>"""


def render_day_row(date_str, info):
    day_label = datetime.date.fromisoformat(date_str).strftime("%a %b %-d")
    save_color = ACCENT if info["save"] >= 0.01 else TEXT_TERTIARY
    save_text = f"+${info['save']:.2f}" if info["save"] >= 0.01 else "$0.00"
    return f"""
        <tr>
          <td style="padding:6px 0; color:{TEXT_SECONDARY}; width:90px;">{day_label}</td>
          <td style="padding:6px 0; color:{TEXT_TERTIARY}; text-align:right; padding-right:16px;">${info['spend']:.2f}</td>
          <td style="padding:6px 0; color:{save_color}; text-align:right; font-weight:500; white-space:nowrap;">{save_text}</td>
        </tr>"""


def render_html(result, start_date, end_date):
    totals = result["totals"]
    save = totals["save"]
    spend = totals["spend"]
    count = totals["count"]
    today_label = datetime.date.today().strftime("%a %b %-d")

    # --- category rows (sorted by save amount, descending) ---
    cat_rows = "".join(
        render_category_row(name, info)
        for name, info in sorted(result["by_category"].items(), key=lambda x: -x[1]["save"])
    )

    # --- day rows: split into "shown" and "collapsed" ---
    sorted_days = sorted(result["by_day"].items())
    shown_days = [(d, info) for d, info in sorted_days if info["save"] >= COLLAPSE_DAYS_UNDER]
    collapsed_days = [(d, info) for d, info in sorted_days if info["save"] < COLLAPSE_DAYS_UNDER]

    day_rows = "".join(render_day_row(d, info) for d, info in shown_days)

    if collapsed_days:
        collapsed_total = sum(info["save"] for d, info in collapsed_days)
        collapsed_text = (
            f"+ {len(collapsed_days)} other day{'s' if len(collapsed_days) != 1 else ''} "
            f"under ${COLLAPSE_DAYS_UNDER:.2f} each (${collapsed_total:.2f} combined)"
        )
        day_rows += f"""
        <tr>
          <td colspan="3" style="padding:10px 0 0 0; color:{TEXT_QUATERNARY}; font-size:12px; font-style:italic;">{collapsed_text}</td>
        </tr>"""

    # --- FYI footnotes for skipped transactions ---
    fyi_lines = []
    if result["skipped_uncategorized"] > 0:
        fyi_lines.append(
            f"{result['skipped_uncategorized']} uncategorized transaction"
            f"{'s' if result['skipped_uncategorized'] != 1 else ''} skipped \u2014 "
            "categorize them in Lunch Money and re-run to include."
        )
    if result["skipped_negative"] > 0:
        fyi_lines.append(
            f"{result['skipped_negative']} refund{'s' if result['skipped_negative'] != 1 else ''} skipped."
        )
    fyi_html = ""
    if fyi_lines:
        fyi_html = f"""
  <tr>
    <td style="padding:0 32px 8px 32px;">
      <p style="margin:0; color:{TEXT_QUATERNARY}; font-size:11px; line-height:1.6; font-style:italic;">FYI: {' '.join(fyi_lines)}</p>
    </td>
  </tr>"""

    # --- assemble the full HTML ---
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Round-up digest</title>
</head>
<body style="margin:0; padding:24px; background:{BG_OUTER}; font-family:{FONT_STACK};">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px; margin:0 auto; background:{BG_CARD}; border-radius:16px; overflow:hidden; font-family:{FONT_STACK};">

  <tr>
    <td style="height:4px; background:linear-gradient(90deg, {ACCENT} 0%, {ACCENT_DARK} 100%); font-size:0; line-height:0;">&nbsp;</td>
  </tr>

  <tr>
    <td style="padding:32px 32px 8px 32px;">
      <p style="margin:0 0 4px 0; color:{TEXT_TERTIARY}; font-size:12px; letter-spacing:1.2px; text-transform:uppercase; font-weight:600;">Round-up digest</p>
      <p style="margin:0; color:{TEXT_SECONDARY}; font-size:14px;">{fmt_date_range(start_date, end_date)}</p>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 32px 32px 32px;">
      <p style="margin:0 0 8px 0; color:{TEXT_SECONDARY}; font-size:14px;">Move to emergency fund</p>
      <p style="margin:0; color:{ACCENT}; font-size:56px; font-weight:700; letter-spacing:-1.5px; line-height:1;">${save:.2f}</p>
      <p style="margin:12px 0 0 0; color:{TEXT_TERTIARY}; font-size:13px;">from ${spend:.2f} spent across {count} transaction{'s' if count != 1 else ''}</p>
    </td>
  </tr>

  <tr>
    <td style="padding:0 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="border-top:1px solid {DIVIDER}; font-size:0; line-height:0;">&nbsp;</td></tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:28px 32px 8px 32px;">
      <p style="margin:0 0 16px 0; color:{TEXT_TERTIARY}; font-size:11px; letter-spacing:1.2px; text-transform:uppercase; font-weight:600;">By category</p>
      {cat_rows}
    </td>
  </tr>

  <tr>
    <td style="padding:20px 32px 0 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="border-top:1px solid {DIVIDER}; font-size:0; line-height:0;">&nbsp;</td></tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 32px 8px 32px;">
      <p style="margin:0 0 16px 0; color:{TEXT_TERTIARY}; font-size:11px; letter-spacing:1.2px; text-transform:uppercase; font-weight:600;">Daily breakdown</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;">
        {day_rows}
      </table>
    </td>
  </tr>
{fyi_html}
  <tr>
    <td style="padding:28px 32px 32px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:{BG_INSET}; border-radius:12px;">
        <tr>
          <td style="padding:22px 24px;">
            <p style="margin:0; color:{TEXT_PRIMARY}; font-size:14px; line-height:1.6;">Transfer <strong style="color:{ACCENT};">${save:.2f}</strong> to your emergency fund, then move this email to your <strong style="color:{TEXT_PRIMARY};">Budgeting</strong> folder.</p>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0 0; color:{TEXT_QUATERNARY}; font-size:11px; text-align:center;">Generated from Lunch Money on {today_label}</p>
    </td>
  </tr>

</table>

</body>
</html>"""


def render_plaintext(result, start_date, end_date):
    """Fallback plaintext version for clients that don't render HTML."""
    totals = result["totals"]
    lines = [
        f"Round-up digest for {start_date} through {end_date}",
        "",
        f"Move to emergency fund: ${totals['save']:.2f}",
        f"From ${totals['spend']:.2f} spent across {totals['count']} transactions.",
        "",
    ]
    if totals["count"] == 0:
        lines.append("No round-up-eligible transactions found in this date range.")
        return "\n".join(lines)

    lines.append("By category:")
    for cat, info in sorted(result["by_category"].items(), key=lambda x: -x[1]["save"]):
        lines.append(f"  {cat}: +${info['save']:.2f} ({info['count']} tx, ${info['spend']:.2f} spent)")
    lines.append("")
    lines.append("By day:")
    for date in sorted(result["by_day"].keys()):
        info = result["by_day"][date]
        day_label = datetime.date.fromisoformat(date).strftime("%a %b %-d")
        lines.append(f"  {day_label}: ${info['spend']:.2f} -> +${info['save']:.2f}")
    lines.append("")
    lines.append(f"Transfer ${totals['save']:.2f} to your emergency fund, then move this email to your Budgeting folder.")
    return "\n".join(lines)


# --- email sending -------------------------------------------------------

def send_email(subject, html_body, text_body):
    msg = EmailMessage()
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = GMAIL_ADDRESS
    msg["Subject"] = subject
    msg.set_content(text_body)  # plaintext fallback
    msg.add_alternative(html_body, subtype="html")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        s.send_message(msg)


# --- entrypoint ----------------------------------------------------------

def get_date_range():
    end_date = os.environ.get("END_DATE", "").strip()
    start_date = os.environ.get("START_DATE", "").strip()
    today = datetime.date.today()
    if not end_date:
        end_date = today.isoformat()
    if not start_date:
        start_date = (today - datetime.timedelta(days=30)).isoformat()
    try:
        datetime.date.fromisoformat(start_date)
        datetime.date.fromisoformat(end_date)
    except ValueError:
        raise SystemExit(f"Invalid date(s). Got start={start_date}, end={end_date}. Use YYYY-MM-DD.")
    return start_date, end_date


def main():
    start_date, end_date = get_date_range()
    print(f"Processing transactions from {start_date} through {end_date}")

    matched_categories = get_matching_categories()
    if not matched_categories:
        raise SystemExit("No matching categories found. Check ROUNDUP_KEYWORDS in roundup.py.")
    print(f"Matched {len(matched_categories)} categories: {list(matched_categories.values())}")

    transactions = get_transactions(start_date, end_date)
    print(f"Fetched {len(transactions)} total transactions in range")

    result = process(transactions, matched_categories)
    save = result["totals"]["save"]
    print(f"Included {result['totals']['count']} transactions, total save: ${save:.2f}")

    subject = f"Move ${save:.2f} to emergency fund ({start_date} \u2192 {end_date})"
    html_body = render_html(result, start_date, end_date)
    text_body = render_plaintext(result, start_date, end_date)

    send_email(subject, html_body, text_body)
    print(f"Email sent: {subject}")


if __name__ == "__main__":
    main()
