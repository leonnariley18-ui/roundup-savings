"""
Diagnostic: prints every field Lunch Money's API returns for your
configured checking account, so we can see whether 'available' balance
or 'pending' info is exposed.

Run via GitHub Actions: Actions -> 'Debug balance fields' -> Run workflow.
"""

import os
import json
import requests

LM_TOKEN = os.environ["LUNCHMONEY_TOKEN"]
LM_BASE = "https://dev.lunchmoney.app/v1"
HEADERS = {"Authorization": f"Bearer {LM_TOKEN}"}

print("\n=== Triggering Plaid refresh ===\n")
try:
    r = requests.post(f"{LM_BASE}/plaid_accounts/fetch", headers=HEADERS, timeout=10)
    print(f"Refresh response status: {r.status_code}")
except Exception as e:
    print(f"Refresh failed: {e}")

import time
print("Waiting 8 seconds for sync...")
time.sleep(8)

print("\n=== Raw Plaid account fields ===\n")
resp = requests.get(f"{LM_BASE}/plaid_accounts", headers=HEADERS)
resp.raise_for_status()
plaid = resp.json().get("plaid_accounts", [])

for a in plaid:
    print(f"\n--- Account: {a.get('display_name') or a.get('name')} (ID {a.get('id')}) ---")
    print(json.dumps(a, indent=2, default=str))

print("\n=== Raw Asset fields (manually managed) ===\n")
resp = requests.get(f"{LM_BASE}/assets", headers=HEADERS)
resp.raise_for_status()
assets = resp.json().get("assets", [])
for a in assets:
    print(f"\n--- Asset: {a.get('display_name') or a.get('name')} (ID {a.get('id')}) ---")
    print(json.dumps(a, indent=2, default=str))

print("\n=== Done ===")
