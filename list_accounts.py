"""
One-time helper: lists all your Lunch Money accounts (Plaid + manual)
with their IDs, names, types, and current balances.

Run this once locally OR via a manual GitHub Actions trigger so you can
copy the right account ID into roundup.py's CHECKING_ACCOUNT_ID config.

Usage (local):
    LUNCHMONEY_TOKEN=your_token python list_accounts.py

The script prints to stdout — in GitHub Actions you'll see the output
in the workflow run logs.
"""

import os
import requests

LM_TOKEN = os.environ["LUNCHMONEY_TOKEN"]
LM_BASE = "https://dev.lunchmoney.app/v1"
HEADERS = {"Authorization": f"Bearer {LM_TOKEN}"}


def main():
    print("\n=== Plaid-connected accounts ===\n")
    resp = requests.get(f"{LM_BASE}/plaid_accounts", headers=HEADERS)
    resp.raise_for_status()
    plaid = resp.json().get("plaid_accounts", [])
    if not plaid:
        print("  (none)")
    for a in plaid:
        print(f"  ID: {a['id']}")
        print(f"  Name: {a.get('name', '?')}  ({a.get('display_name') or 'no display name'})")
        print(f"  Type: {a.get('type', '?')} / subtype: {a.get('subtype', '?')}")
        print(f"  Institution: {a.get('institution_name', '?')}")
        print(f"  Balance: {a.get('balance', '?')} {a.get('currency', '').upper()}")
        print(f"  Last fetch: {a.get('last_fetch', '?')}")
        print(f"  Status: {a.get('status', '?')}")
        print()

    print("\n=== Manually managed assets ===\n")
    resp = requests.get(f"{LM_BASE}/assets", headers=HEADERS)
    resp.raise_for_status()
    assets = resp.json().get("assets", [])
    if not assets:
        print("  (none)")
    for a in assets:
        print(f"  ID: {a['id']}")
        print(f"  Name: {a.get('name', '?')}  ({a.get('display_name') or 'no display name'})")
        print(f"  Type: {a.get('type_name', '?')} / subtype: {a.get('subtype_name', '?')}")
        print(f"  Balance: {a.get('balance', '?')} {a.get('currency', '').upper()}")
        print()

    print("\nFind your checking account above. Copy its ID number.")
    print("Then in roundup.py set:")
    print("    CHECKING_ACCOUNT_ID = <that number>")
    print("    CHECKING_ACCOUNT_SOURCE = 'plaid'  # or 'asset' if manually managed")


if __name__ == "__main__":
    main()
