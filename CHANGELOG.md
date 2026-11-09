# Changelog

One entry per merged PR, newest first. This started late — PRs #1–8 are
reconstructed from their titles; everything from #9 on was written as it
shipped.

## PR #14 — Add "Export all data" to the drawer
A button in the drawer (next to Sign out) that pulls every table in the
`ledger` schema for the signed-in user and downloads it as one JSON file.
Also fixed a real behavior gap: a fully-resolved Lunch week was only
ever advancing on the literal next Monday, because the old code computed
the next Monday as "the Monday of today's calendar week" — which on a
Saturday or Sunday inside that same week just writes the same date back.
Now a finished week closes the moment the weekend starts instead of
waiting for Monday, with a small "last week's all wrapped up" card for
the gap before the new week's own Monday arrives.

## PR #13 — Calendar fix, the Save tab, and a Lunch/Save Settings redo
Started as one fix and picked up everything else built in this branch's
lifetime before it merged:
- **Dismissed paybacks now drop off the calendar.** Dismissing one in
  the Paybacks tab only hid it from that tab's own list — the
  calendar's deadline/target markers never checked the `dismissed` flag,
  so a dismissed payback kept showing indefinitely. Now it drops off the
  same way a cleared one does.
- **New Save tab.** Sweeps what Lunch has banked into real savings on
  its own weekly cadence — every Monday opens as its own week
  immediately, sweeping wraps up every open week at once with an
  optional "treat yourself" carved out of the total, and nothing is
  stored until a week is actually swept.
- **Round-up is now locked** behind a grey overlay in the nav — still
  fully wired underneath, just paused until Lunch Money categorization
  restarts.
- **Settings is now a real sliding side panel** for both Lunch and
  Save, instead of an inline block that just expanded the page.
- Fixed a clipped "New amount" placeholder in both Settings panels.

## PR #12 — Lunch: first-ever Start tracking shouldn't demand a backlog that was never real
`open_week_start` was set once, at settings-row creation, to whatever
Monday was current then — since tracking stayed paused until the user
deliberately started it, that week never got real data and could never
auto-advance. The never-started Start-tracking action now jumps straight
to the current week instead.

## PR #11 — Lunch: stop week-list days from acting while tracking is paused
Only the Today card was gated on `tracking_paused` — the "Rest of this
week" list let you End or log a day's spending even while tracking had
never been started, which silently counted toward rollover.

## PR #10 — Lunch: fix Settings panel visibility, add first-run onboarding prompt
The Settings panel rendered below the fold with no visible feedback when
toggled. Also added the dedicated "Lunch isn't tracking yet" welcome
card for the first-ever open, instead of a quiet always-on default.

## PR #9 — Add Lunch tab: daily budget tracking with rollover
New tab: a $40/day spending budget with unlimited rollover of unspent
days, quick-add logging, weekend handling, Monday-only scheduled
limit changes, and closed-weeks history.

## PR #8 — Persist linked-decision history and fix three mobile display bugs
## PR #7 — Paybacks redesign, decision linking, mobile parity, and bug fixes
## PR #6 — Give each payback its own card instead of a connected list
## PR #5 — Mobile: payback form parity, month-view today button, merge Bills in
## PR #4 — Payday logic alignment
## PR #3, #2, #1 — Initial dashboard setup
The original build: Calendar, Which card, Statements, Paybacks, Bills,
the loan, and the Supabase/auth/RLS foundation everything else sits on.
