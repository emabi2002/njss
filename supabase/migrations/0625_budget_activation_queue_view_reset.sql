-- =============================================================================
-- NJSS 0625 — BUDGET ACTIVATION QUEUE VIEW RESET
-- Deployment-safety bridge between migrations 062 and 063.
--
-- Migration 062 appends fingerprint/reconciliation columns to
-- budget_activation_batches. The original queue view from migration 056 was
-- defined with bab.*, so CREATE OR REPLACE VIEW in migration 063 could otherwise
-- be rejected by PostgreSQL when the expanded column order changes.
--
-- This migration intentionally does not use CASCADE. Any unexpected database
-- dependency must stop deployment for review rather than be removed silently.
-- =============================================================================

BEGIN;

DROP VIEW IF EXISTS public.v_budget_activation_queue;

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES (
  'latest_database_migration',
  '0625_budget_activation_queue_view_reset',
  'Latest applied NJSS migration identifier.'
)
ON CONFLICT (setting_key) DO UPDATE SET
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  updated_at = NOW();

COMMIT;
