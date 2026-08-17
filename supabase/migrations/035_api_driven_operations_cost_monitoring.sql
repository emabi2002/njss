-- NJSS Phase 6 — API-driven operations cost monitoring
-- Operating/infrastructure/service costs must originate from provider APIs or machine-readable integrations.
-- This migration deprecates manual operational-cost storage without touching transactional NJSS financial data.

CREATE TABLE IF NOT EXISTS operations_cost_provider_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  service_name TEXT,
  cost_category TEXT,
  billing_period TEXT,
  usage_label TEXT,
  usage_value TEXT,
  usage_unit TEXT,
  native_currency VARCHAR(10),
  native_amount NUMERIC(15,4),
  base_currency VARCHAR(10) NOT NULL DEFAULT 'PGK',
  base_amount NUMERIC(15,4),
  exchange_rate NUMERIC(18,8),
  exchange_rate_source TEXT,
  exchange_rate_checked_at TIMESTAMPTZ,
  api_status TEXT NOT NULL,
  billing_status TEXT,
  data_source TEXT,
  estimated BOOLEAN NOT NULL DEFAULT true,
  last_synchronised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operations_cost_snapshots_provider ON operations_cost_provider_snapshots(provider_id, last_synchronised_at DESC);
CREATE INDEX IF NOT EXISTS idx_operations_cost_snapshots_period ON operations_cost_provider_snapshots(billing_period, last_synchronised_at DESC);

CREATE TABLE IF NOT EXISTS operations_provider_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  api_service TEXT,
  sync_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_completed_at TIMESTAMPTZ,
  records_retrieved INTEGER DEFAULT 0,
  billing_period TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  initiated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  initiated_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operations_provider_sync_logs_provider ON operations_provider_sync_logs(provider_id, sync_started_at DESC);

ALTER TABLE operations_cost_provider_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_provider_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operations_cost_snapshots_select_admin ON operations_cost_provider_snapshots;
CREATE POLICY operations_cost_snapshots_select_admin ON operations_cost_provider_snapshots
  FOR SELECT USING (
    (SELECT fn_current_user_has_permission('operations.view'))
    OR (SELECT fn_current_user_has_permission('operations.manage'))
    OR (SELECT fn_current_user_has_permission('settings.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

DROP POLICY IF EXISTS operations_sync_logs_select_admin ON operations_provider_sync_logs;
CREATE POLICY operations_sync_logs_select_admin ON operations_provider_sync_logs
  FOR SELECT USING (
    (SELECT fn_current_user_has_permission('operations.view'))
    OR (SELECT fn_current_user_has_permission('operations.manage'))
    OR (SELECT fn_current_user_has_permission('settings.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

REVOKE ALL ON operations_cost_provider_snapshots, operations_provider_sync_logs FROM anon;
GRANT SELECT ON operations_cost_provider_snapshots, operations_provider_sync_logs TO authenticated;

-- Remove/deprecate manual infrastructure cost entry surfaces.
DROP TABLE IF EXISTS system_operating_costs CASCADE;
DELETE FROM system_settings WHERE setting_key = 'operations_manual_metrics';

INSERT INTO system_alert_settings (code, label, threshold_value, enabled, notes)
VALUES
  ('provider_api_not_synchronised_24h', 'Provider API has not synchronised for 24 hours', 24, true, 'Warn when a configured provider billing or usage API has not synchronised recently.'),
  ('provider_billing_data_unavailable', 'Provider billing data unavailable', 1, true, 'Warn when configured provider APIs cannot return cost or billing information.'),
  ('provider_monthly_cost_threshold', 'API-derived monthly operating cost threshold', 5000, true, 'Warn when known API-derived monthly operating cost exceeds the configured PGK threshold.'),
  ('provider_cost_change_threshold', 'Provider API cost change threshold', 20, true, 'Warn when a provider API-derived cost changes materially from the previous billing period.')
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  threshold_value = COALESCE(system_alert_settings.threshold_value, EXCLUDED.threshold_value),
  enabled = system_alert_settings.enabled,
  notes = EXCLUDED.notes,
  updated_at = NOW();
