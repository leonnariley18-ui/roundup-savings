-- Lunch should never prompt for logging until tracking is explicitly started.
-- The original default left tracking_paused = false, so a brand-new settings
-- row (created the first time the tab loads) was "live" immediately and
-- started nagging about unresolved days before the user ever opted in.
alter table ledger.lunch_settings alter column tracking_paused set default true;

update ledger.lunch_settings set tracking_paused = true where tracking_paused = false;
