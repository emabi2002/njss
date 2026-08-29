-- NJSS Task 9 production post-deployment checks — READ ONLY
-- Run only after migrations 056 -> 057 -> 058 -> 059 -> 060 -> 061 -> 062 -> 0625 -> 063
-- have all completed successfully. These queries do not prepare, submit or activate a budget.

-- 1. Schema objects and final migration marker.
SELECT
  to_regclass('public.budget_activation_batches') IS NOT NULL AS has_activation_batches,
  to_regclass('public.budget_activation_lines') IS NOT NULL AS has_activation_lines,
  to_regclass('public.finance_posting_mappings') IS NOT NULL AS has_canonical_mapping_table,
  to_regclass('public.budget_activation_line_snapshots') IS NOT NULL AS has_activation_snapshots,
  to_regclass('public.v_budget_activation_queue') IS NOT NULL AS has_activation_queue,
  to_regclass('public.v_finance_posting_mapping_admin') IS NOT NULL AS has_finance_mapping_admin,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='expense_code_registry' AND column_name='chart_of_account_id'
  ) AS has_posting_coa_column,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='budget_activation_batches' AND column_name='validation_fingerprint'
  ) AS has_validation_fingerprint;

SELECT setting_value AS latest_database_migration
FROM public.system_settings
WHERE setting_key='latest_database_migration';
-- Expected final marker: 063_budget_activation_fk_only_guards

-- 2. Approved budgets should have staging headers, but ZERO operational allocations
-- must remain ZERO until Registrar activation.
SELECT bab.status, COUNT(*)::int AS batch_count,
       COALESCE(SUM(bab.approved_line_count),0)::int AS approved_line_count,
       COALESCE(SUM(bab.approved_total),0)::numeric(15,2) AS approved_total,
       COALESCE(SUM(bab.activation_total),0)::numeric(15,2) AS activation_total
FROM public.budget_activation_batches bab
GROUP BY bab.status
ORDER BY bab.status;

SELECT COUNT(*)::int AS active_excel_budget_allocations,
       COALESCE(SUM(original_budget),0)::numeric(15,2) AS active_excel_budget_total
FROM public.budget_allocations
WHERE source_module='EXCEL_BUDGET' AND is_active=true;
-- Before any Registrar activation: expected 0 / K0.00 for the reconciled baseline.

-- 3. Existing approved submission headers should reconcile to source lines/totals.
SELECT s.submission_number,
       COUNT(l.id)::int AS source_line_count,
       COALESCE(SUM(l.annual_estimate),0)::numeric(15,2) AS source_total,
       bab.approved_line_count,
       bab.approved_total,
       bab.status,
       bab.mapped_line_count,
       bab.unmapped_line_count,
       bab.activation_total,
       bab.variance
FROM public.divisional_budget_submissions s
JOIN public.divisional_budget_lines l ON l.submission_id=s.id
LEFT JOIN public.budget_activation_batches bab ON bab.submission_id=s.id
WHERE s.status='APPROVED' AND s.is_locked=true
GROUP BY s.id, s.submission_number, bab.id, bab.approved_line_count,
         bab.approved_total, bab.status, bab.mapped_line_count,
         bab.unmapped_line_count, bab.activation_total, bab.variance
ORDER BY s.submission_number;

-- 4. No immutable activation evidence should exist before Registrar activation.
SELECT COUNT(*)::int AS activation_snapshot_count
FROM public.budget_activation_line_snapshots;

-- 5. RBAC grants required by the dual-control workflow.
SELECT r.name AS role_name, rp.permission, rp.is_allowed
FROM public.roles r
JOIN public.role_permissions rp ON rp.role_id=r.id
WHERE r.name IN ('System Administrator','Registrar')
  AND rp.permission IN (
    'budget.activation.view','budget.activation.prepare','budget.activation.validate',
    'budget.activation.submit','budget.activation.authorize','budget.activation.report'
  )
ORDER BY r.name, rp.permission;

-- 6. Unsafe legacy direct allocator must not be executable by authenticated users.
SELECT has_function_privilege(
  'authenticated',
  'public.create_operational_allocations_from_divisional_budget(uuid,text)',
  'EXECUTE'
) AS authenticated_can_execute_legacy_allocator;
-- Expected false.

-- 7. Canonical mapping readiness. Immediately after schema deployment this may
-- legitimately be zero because Administrator master-data remediation comes next.
SELECT mapping_status, COUNT(*)::int AS mapping_count
FROM public.v_finance_posting_mapping_admin
GROUP BY mapping_status
ORDER BY mapping_status;

-- 8. Final stop condition before any Registrar activation:
-- For every selected batch, preflight must show all lines READY, mapped total =
-- approved total, variance = K0.00, validation_error_count = 0, and a non-null
-- validation_fingerprint after Administrator submission.
SELECT id, submission_id, status,
       approved_line_count, mapped_line_count, unmapped_line_count,
       approved_total, activation_total, variance,
       validation_error_count, validation_fingerprint,
       prepared_by, submitted_for_activation_by, authorised_by, activated_at
FROM public.budget_activation_batches
ORDER BY financial_year, created_at, id;
