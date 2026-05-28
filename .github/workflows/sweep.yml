name: Pre-payday sweep

# Runs every Wednesday at 7pm ET (EDT) — 23:00 UTC.
# During EST (Nov-Mar) it shifts to 6pm ET because GitHub cron doesn't
# adjust for daylight saving time. Still works fine for the use case.
# Can also be triggered manually anytime via "Run workflow".

on:
  schedule:
    - cron: "0 23 * * 3"   # 23:00 UTC every Wednesday
  workflow_dispatch:

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install requests
      - name: Run pre-payday sweep
        env:
          LUNCHMONEY_TOKEN: ${{ secrets.LUNCHMONEY_TOKEN }}
          GMAIL_ADDRESS: ${{ secrets.GMAIL_ADDRESS }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
        run: python sweep.py
