-- NJSS Task 9 production preflight — READ ONLY
-- Run before applying migrations 056 -> 063.
-- Expected current baseline as at 2026-08-28:
--   11 approved/locked submissions, 68 lines, K5,630,150.00
--   zero active EXCEL_BUDGET allocations for those approved submissions.

-- 1. Approved baseline and operational-allocation classification.
WITH approved AS (
  SELECT s.id, s.submission_number, s.budget_year, s.is_locked,
         COUNT(l.id)::int AS line_count,
         COALESCE(SUM(l.annual_estimate),0)::numeric(15,2) AS approved_total
  FROM public.divisional_budget_submissions s
  JOIN public.divisional_budget_lines l ON l.submission_id = s.id
  WHERE s.status = 'APPROVED' AND s.is_locked = true
  GROUP BY s.id, s.submission_number, s.budget_year, s.is_locked
), allocations AS (
  SELECT ba.source_budget_submission_id AS submission_id,
         COUNT(*) FILTER (WHERE ba.is_active = true)::int AS active_allocation_count,
         COALESCE(SUM(ba.original_budget) FILTER (WHERE ba.is_active = true),0)::numeric(15,2) AS active_allocation_total
  FROM public.budget_allocations ba
  WHERE ba.source_module = 'EXCEL_BUDGET'
  GROUP BY ba.source_budget_submission_id
)
SELECT a.*,
       COALESCE(x.active_allocation_count,0) AS active_allocation_count,
       COALESCE(x.active_allocation_total,0)::numeric(15,2) AS active_allocation_total,
       CASE
         WHEN COALESCE(x.active_allocation_count,0)=0 THEN 'ZERO'
         WHEN x.active_allocation_count=a.line_count
              AND ABS(COALESCE(x.active_allocation_total,0)-a.approved_total)<=0.009 THEN 'COMPLETE'
         ELSE 'PARTIAL'
       END AS allocation_classification
FROM approved a
LEFT JOIN allocations x ON x.submission_id=a.id
ORDER BY a.submission_number;

-- STOP if any approved submission is PARTIAL or COMPLETE unless it has been
-- separately reconciled and explicitly accepted as legacy history.

-- 2. Aggregate baseline.
SELECT COUNT(DISTINCT s.id) AS approved_submission_count,
       COUNT(l.id) AS approved_line_count,
       COALESCE(SUM(l.annual_estimate),0)::numeric(15,2) AS approved_total
FROM public.divisional_budget_submissions s
JOIN public.divisional_budget_lines l ON l.submission_id=s.id
WHERE s.status='APPROVED' AND s.is_locked=true;

-- 3. Monthly cash-flow reconciliation. Expected unreconciled_lines = 0.
SELECT COUNT(*) FILTER (
         WHERE ABS(COALESCE(l.monthly_allocation_total,0)-COALESCE(l.annual_estimate,0)) > 0.009
            OR ABS(COALESCE(l.allocation_variance,0)) > 0.009
       )::int AS unreconciled_lines,
       COUNT(*)::int AS approved_lines
FROM public.divisional_budget_submissions s
JOIN public.divisional_budget_lines l ON l.submission_id=s.id
WHERE s.status='APPROVED' AND s.is_locked=true;

-- 4. Duplicate reciprocal Finance/Posting links. Expected both counts = 0.
SELECT
  (SELECT COUNT(*) FROM (
     SELECT ecr.expense_ledger_id
     FROM public.expense_code_registry ecr
     WHERE ecr.expense_ledger_id IS NOT NULL AND ecr.is_active=true
     GROUP BY ecr.expense_ledger_id HAVING COUNT(*)>1
   ) q) AS duplicate_active_posting_links,
  (SELECT COUNT(*) FROM (
     SELECT el.expense_code_registry_id
     FROM public.expense_ledger el
     WHERE el.expense_code_registry_id IS NOT NULL AND el.is_active=true
     GROUP BY el.expense_code_registry_id HAVING COUNT(*)>1
   ) q) AS duplicate_active_finance_links;

-- 5. Required Task 9 actor roles. Expected at least one active user in each role.
SELECT r.name AS role_name, COUNT(DISTINCT u.id)::int AS active_user_count
FROM public.roles r
LEFT JOIN public.user_roles ur ON ur.role_id=r.id
LEFT JOIN public.users u ON u.id=ur.user_id AND u.is_active=true
WHERE r.name IN ('System Administrator','Registrar') AND r.is_active=true
GROUP BY r.name
ORDER BY r.name;

-- 6. Production user schema contract used by migrations 057/061/062/063.
-- Expected: full_name=true; first_name=false; last_name=false.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='full_name') AS has_full_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='first_name') AS has_first_name,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='last_name') AS has_last_name;

-- 7. Task 9 should not already be partially deployed.
SELECT
  to_regclass('public.budget_activation_batches') IS NOT NULL AS has_activation_batches,
  to_regclass('public.finance_posting_mappings') IS NOT NULL AS has_canonical_mapping_table,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='expense_code_registry' AND column_name='chart_of_account_id'
  ) AS has_posting_coa_column;

-- 8. Approved Division Cost Centre readiness. Before initial deployment the
-- expected result is 11 rows with no exact active Cost Centre match.
WITH approved_divisions AS (
  SELECT DISTINCT bd.id, bd.code AS division_code, bd.name AS division_name,
         NULLIF(trim(bd.cost_centre_code),'') AS required_cost_centre_code,
         NULLIF(trim(bd.cost_centre_name),'') AS required_cost_centre_name,
         COALESCE(s.department_id,bd.department_id) AS department_id,
         bd.section_id
  FROM public.divisional_budget_submissions s
  JOIN public.budget_divisions bd ON bd.id=s.division_id
  WHERE s.status='APPROVED' AND s.is_locked=true
)
SELECT ad.division_code, ad.division_name,
       ad.required_cost_centre_code, ad.required_cost_centre_name,
       COUNT(cc.id) FILTER (WHERE cc.is_active=true)::int AS active_exact_matches
FROM approved_divisions ad
LEFT JOIN public.cost_centres cc
  ON upper(trim(cc.code))=upper(ad.required_cost_centre_code)
 AND cc.department_id=ad.department_id
 AND (ad.section_id IS NULL OR cc.section_id IS NULL OR cc.section_id=ad.section_id)
GROUP BY ad.division_code, ad.division_name,
         ad.required_cost_centre_code, ad.required_cost_centre_name
ORDER BY ad.division_code;
