"""
Pre-payday zero-out sweep notifier.

Runs every Wednesday at 7pm ET (via the scheduled workflow) and also
manually-triggerable anytime. Reads your current checking balance from
Lunch Money and emails you the sweep amount with the same design as
the round-up digest.

Required environment variables:
  LUNCHMONEY_TOKEN, GMAIL_ADDRESS, GMAIL_APP_PASSWORD

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

CHECKING_ACCOUNT_ID = 288572         # set after running list_accounts workflow
CHECKING_ACCOUNT_SOURCE = "plaid"   # "plaid" or "asset"
ZERO_OUT_BUFFER = 0.0               # dollars to leave behind

LM_BASE = "https://dev.lunchmoney.app/v1"
HEADERS = {"Authorization": f"Bearer {LM_TOKEN}"}

# --- design palette (matches roundup.py) ---
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


# --- Lunch Money ---------------------------------------------------------

def trigger_plaid_refresh():
    try:
        requests.post(f"{LM_BASE}/plaid_accounts/fetch", headers=HEADERS, timeout=10)
    except Exception as e:
        print(f"  (plaid refresh request failed, will use cached balance: {e})")


def get_account_info():
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


# --- email rendering -----------------------------------------------------

def render_html(sweep, balance, buffer_amt, account_name, last_fetch):
    today_label = datetime.date.today().strftime("%a %b %-d")

    # Optional buffer line
    buffer_html = ""
    if buffer_amt > 0:
        buffer_html = f"""
            <tr>
              <td style="padding:8px 0; color:{TEXT_SECONDARY}; font-size:14px;">Buffer kept</td>
              <td style="padding:8px 0; color:{TEXT_PRIMARY}; font-size:14px; text-align:right; font-weight:500;">${buffer_amt:.2f}</td>
            </tr>"""

    # Last sync timestamp
    sync_html = ""
    if last_fetch:
        sync_html = f"""
  <tr>
    <td style="padding:0 32px 8px 32px;">
      <p style="margin:0; color:{TEXT_QUATERNARY}; font-size:11px; line-height:1.6; font-style:italic;">Balance last synced: {last_fetch}</p>
    </td>
  </tr>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pre-payday sweep</title>
</head>
<body style="margin:0; padding:24px; background:{BG_OUTER}; font-family:{FONT_STACK};">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px; margin:0 auto; background:{BG_CARD}; border-radius:16px; overflow:hidden; font-family:{FONT_STACK};">

  <tr>
    <td style="height:4px; background:linear-gradient(90deg, {ACCENT} 0%, {ACCENT_DARK} 100%); font-size:0; line-height:0;">&nbsp;</td>
  </tr>

  <tr>
    <td style="padding:32px 32px 8px 32px;">
      <p style="margin:0 0 4px 0; color:{TEXT_TERTIARY}; font-size:12px; letter-spacing:1.2px; text-transform:uppercase; font-weight:600;">Pre-payday sweep</p>
      <p style="margin:0; color:{TEXT_SECONDARY}; font-size:14px;">{today_label} \u2014 right before payday</p>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 32px 32px 32px;">
      <p style="margin:0 0 8px 0; color:{TEXT_SECONDARY}; font-size:14px;">Sweep to emergency fund</p>
      <p style="margin:0; color:{ACCENT}; font-size:56px; font-weight:700; letter-spacing:-1.5px; line-height:1;">${sweep:.2f}</p>
      <p style="margin:12px 0 0 0; color:{TEXT_TERTIARY}; font-size:13px;">leaving your checking ready for tomorrow's deposit</p>
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
    <td style="padding:24px 32px 8px 32px;">
      <p style="margin:0 0 16px 0; color:{TEXT_TERTIARY}; font-size:11px; letter-spacing:1.2px; text-transform:uppercase; font-weight:600;">Account</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="padding:8px 0; color:{TEXT_SECONDARY}; font-size:14px;">{account_name}</td>
              <td style="padding:8px 0; color:{TEXT_PRIMARY}; font-size:14px; text-align:right; font-weight:500;">${balance:.2f}</td>
            </tr>{buffer_html}
      </table>
    </td>
  </tr>
{sync_html}
  <tr>
    <td style="padding:28px 32px 32px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:{BG_INSET}; border-radius:12px;">
        <tr>
          <td style="padding:22px 24px;">
            <p style="margin:0; color:{TEXT_PRIMARY}; font-size:14px; line-height:1.6;">Transfer <strong style="color:{ACCENT};">${sweep:.2f}</strong> to your emergency fund before payday hits, then move this email to your <strong style="color:{TEXT_PRIMARY};">Budgeting</strong> folder.</p>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0 0; color:{TEXT_QUATERNARY}; font-size:11px; text-align:center;">Generated from Lunch Money on {today_label}</p>
    </td>
  </tr>

</table>

</body>
</html>"""


def render_plaintext(sweep, balance, buffer_amt, account_name, last_fetch):
    today = datetime.date.today().strftime("%a %b %-d, %Y")
    lines = [
        f"Pre-payday zero-out sweep \u2014 {today}",
        "",
        f"Sweep to emergency fund: ${sweep:.2f}",
        "",
        f"  {account_name} balance: ${balance:.2f}",
    ]
    if buffer_amt > 0:
        lines.append(f"  Buffer kept: ${buffer_amt:.2f}")
    if last_fetch:
        lines.append(f"  Last synced: {last_fetch}")
    lines += [
        "",
        f"Transfer ${sweep:.2f} to your emergency fund before payday hits, "
        "then move this email to your Budgeting folder.",
    ]
    return "\n".join(lines)


# --- email sending -------------------------------------------------------

def send_email(subject, html_body, text_body):
    msg = EmailMessage()
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = GMAIL_ADDRESS
    msg["Subject"] = subject
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")
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
        print("Waiting 8 seconds for sync...")
        time.sleep(8)

    balance, name, last_fetch = get_account_info()
    if balance is None:
        raise SystemExit(f"Account with ID {CHECKING_ACCOUNT_ID} not found.")

    sweep = max(0.0, balance - ZERO_OUT_BUFFER)
    subject = f"Sweep ${sweep:.2f} to emergency fund before payday"
    html_body = render_html(sweep, balance, ZERO_OUT_BUFFER, name, last_fetch)
    text_body = render_plaintext(sweep, balance, ZERO_OUT_BUFFER, name, last_fetch)

    send_email(subject, html_body, text_body)
    print(f"Email sent: {subject}")


if __name__ == "__main__":
    main()
