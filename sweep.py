"""
Pre-payday zero-out sweep notifier.

Triggered manually (probably Wednesday night, the day before payday).
Reads your current checking balance from Lunch Money and emails you
the sweep amount.

Required environment variables:
  LUNCHMONEY_TOKEN
  GMAIL_ADDRESS
  GMAIL_APP_PASSWORD

Config (edit below):
  CHECKING_ACCOUNT_ID, CHECKING_ACCOUNT_SOURCE, ZERO_OUT_BUFFER
"""

import os
import time
import smtplib
import datetime
from email.message import EmailMessage

import requests

# --- config --------------------------------------------------------------

LM_TOKEN = os.environ["LUNCHMONEY_TOKEN"]
GMAIL_ADDRESS = os.environ["GMAIL_ADDRESS"]
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]

# Set these after running list_accounts.yml workflow once.
CHECKING_ACCOUNT_ID = None         # e.g. 12345
CHECKING_ACCOUNT_SOURCE = "plaid"   # "plaid" or "asset"
ZERO_OUT_BUFFER = 0.0               # dollars to leave behind

LM_BASE = "https://dev.lunchmoney.app/v1"
HEADERS = {"Authorization": f"Bearer {LM_TOKEN}"}


# --- Lunch Money ---------------------------------------------------------

def trigger_plaid_refresh():
    try:
        requests.post(f"{LM_BASE}/plaid_accounts/fetch", headers=HEADERS, timeout=10)
    except Exception as e:
        print(f"  (plaid refresh request failed, will use cached balance: {e})")


def get_account_info():
    """Return (balance, name, last_fetch_iso) or (None, None, None)."""
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
    else:
        resp = requests.get(f"{LM_BASE}/assets", headers=HEADERS)
        resp.raise_for_status()
        for a in resp.json().get("assets", []):
            if a["id"] == CHECKING_ACCOUNT_ID:
                return (
                    float(a.get("balance", 0)),
                    a.get("display_name") or a.get("name") or "Checking",
                    None,
                )

    return None, None, None


# --- email ---------------------------------------------------------------

def send_email(subject, body):
    msg = EmailMessage()
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = GMAIL_ADDRESS
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        s.send_message(msg)


# --- main ----------------------------------------------------------------

def main():
    if CHECKING_ACCOUNT_ID is None:
        raise SystemExit(
            "CHECKING_ACCOUNT_ID not set in sweep.py. "
            "Run the 'List my Lunch Money accounts' workflow to find your ID."
        )

    if CHECKING_ACCOUNT_SOURCE == "plaid":
        print("Triggering Plaid refresh...")
        trigger_plaid_refresh()
        print("Waiting 8 seconds for sync to complete...")
        time.sleep(8)

    balance, name, last_fetch = get_account_info()
    if balance is None:
        raise SystemExit(f"Account with ID {CHECKING_ACCOUNT_ID} not found.")

    sweep = max(0.0, balance - ZERO_OUT_BUFFER)
    today = datetime.date.today()

    subject = f"Sweep ${sweep:.2f} to emergency fund before payday"
    lines = [
        f"Pre-payday zero-out sweep \u2014 {today.strftime('%a %b %-d, %Y')}",
        "",
        "=" * 50,
        f"SWEEP TO EMERGENCY FUND: ${sweep:.2f}",
        "=" * 50,
        "",
        f"  {name} balance: ${balance:.2f}",
    ]
    if ZERO_OUT_BUFFER > 0:
        lines.append(f"  Buffer kept:    ${ZERO_OUT_BUFFER:.2f}")
    if last_fetch:
        lines.append(f"  Last synced:    {last_fetch}")

    send_email(subject, "\n".join(lines))
    print(f"Email sent: {subject}")


if __name__ == "__main__":
    main()
