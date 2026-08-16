-- NJSS PHASE 6 — Live provider cost monitoring support
-- Additive configuration only. Provider tokens remain server environment variables,
-- never database rows or client-visible values.

INSERT INTO system_alert_settings (code, label, threshold_value, enabled, notes)
VALUES
  ('live_cost_provider_unavailable', 'Live cost provider unavailable', 1, true, 'Raised operationally when a configured live provider cost connector cannot be reached.'),
  ('live_cost_provider_not_configured', 'Live cost provider not configured', 1, true, 'Raised operationally when Supabase, Netlify or another monitored provider is missing server-side connector configuration.'),
  ('live_cost_monthly_change_threshold', 'Live provider monthly cost change threshold', 25, true, 'Warn when current live provider charges differ materially from the previous month.')
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  threshold_value = COALESCE(system_alert_settings.threshold_value, EXCLUDED.threshold_value),
  enabled = system_alert_settings.enabled,
  notes = EXCLUDED.notes,
  updated_at = NOW();
