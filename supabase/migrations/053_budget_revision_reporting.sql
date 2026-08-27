-- =============================================================================
-- NJSS 053 — BUDGET REVISION / REFORECAST REPORTING
-- Extends authoritative budget reporting with approved budget lineage and keeps
-- budget availability distinct from released-cash availability.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Authoritative budget position.
--    Existing columns remain in their established order for compatibility.
--    Revision/reporting columns are appended at the end.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_authoritative_budget_position
WITH (security_invoker = true) AS
SELECT
  ba.id AS budget_allocation_id,
  ba.financial_year,
  ba.department_id,
  d.name AS department_name,
  ba.section_id,
  s.name AS section_name,
  ba.cost_centre_id,
  cc.code AS cost_centre_code,
  cc.name AS cost_centre_name,
  ba.project_id,
  p.name AS project_name,
  ba.funding_source_id,
  fs.code AS funding_source_code,
  fs.name AS funding_source_name,
  ba.expense_code_registry_id,
  ecr.full_expense_code,
  ba.revised_budget::NUMERIC(15,2) AS approved_budget,
  COALESCE((
    SELECT SUM(fal.allocated_amount)
    FROM funding_allocations fal
    WHERE fal.budget_allocation_id = ba.id
      AND fal.status = 'APPROVED'
  ), 0)::NUMERIC(15,2) AS funded_amount,
  COALESCE((
    SELECT SUM(qr.released_amount)
    FROM quarterly_releases qr
    WHERE qr.budget_allocation_id = ba.id
  ), 0)::NUMERIC(15,2) AS released_amount,
  COALESCE((
    SELECT SUM(h.total_estimated_amount)
    FROM ff3_headers h
    WHERE h.financial_year = ba.financial_year
      AND h.status = 'SUBMITTED'
      AND (
        h.budget_allocation_id = ba.id
        OR (
          h.budget_allocation_id IS NULL
          AND h.expense_code_registry_id = ba.expense_code_registry_id
          AND (h.department_id IS NULL OR h.department_id IS NOT DISTINCT FROM ba.department_id)
          AND (h.section_id IS NULL OR h.section_id IS NOT DISTINCT FROM ba.section_id)
          AND (h.funding_source_id IS NULL OR h.funding_source_id IS NOT DISTINCT FROM ba.funding_source_id)
          AND 1 = (
            SELECT COUNT(*)
            FROM budget_allocations bx
            WHERE bx.financial_year = h.financial_year
              AND bx.is_active = true
              AND bx.expense_code_registry_id = h.expense_code_registry_id
              AND (h.department_id IS NULL OR bx.department_id IS NOT DISTINCT FROM h.department_id)
              AND (h.section_id IS NULL OR bx.section_id IS NOT DISTINCT FROM h.section_id)
              AND (h.funding_source_id IS NULL OR bx.funding_source_id IS NOT DISTINCT FROM h.funding_source_id)
          )
        )
      )
  ), 0)::NUMERIC(15,2) AS pending_amount,
  COALESCE((
    SELECT SUM(c.committed_amount - COALESCE(c.paid_amount, 0))
    FROM ff3_commitments c
    WHERE c.budget_allocation_id = ba.id
      AND c.status IN ('ACTIVE','PARTIALLY_PAID')
  ), 0)::NUMERIC(15,2) AS outstanding_commitment,
  COALESCE((
    SELECT SUM(COALESCE(c.paid_amount, 0))
    FROM ff3_commitments c
    WHERE c.budget_allocation_id = ba.id
      AND c.status <> 'CANCELLED'
  ), 0)::NUMERIC(15,2) AS actual_expenditure,
  (
    COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.budget_allocation_id = ba.id), 0)
    - COALESCE((SELECT SUM(c.committed_amount - COALESCE(c.paid_amount, 0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID')), 0)
    - COALESCE((SELECT SUM(COALESCE(c.paid_amount, 0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status <> 'CANCELLED'), 0)
  )::NUMERIC(15,2) AS available_amount,
  (
    ba.revised_budget
    - COALESCE((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.budget_allocation_id = ba.id AND fal.status = 'APPROVED'), 0)
  )::NUMERIC(15,2) AS unfunded_amount,
  (
    COALESCE((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.budget_allocation_id = ba.id AND fal.status = 'APPROVED'), 0)
    - COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.budget_allocation_id = ba.id), 0)
  )::NUMERIC(15,2) AS unreleased_funding,

  -- Revision-aware lineage appended for Task 6 reporting.
  COALESCE(ba.original_budget, 0)::NUMERIC(15,2) AS original_budget,
  COALESCE(ba.supplemental_budget, 0)::NUMERIC(15,2) AS supplemental_budget,
  COALESCE(ba.revision_adjustment, 0)::NUMERIC(15,2) AS revision_adjustment,
  COALESCE(ba.revised_budget, 0)::NUMERIC(15,2) AS current_revised_budget,
  (
    COALESCE(ba.revised_budget, 0)
    - COALESCE((SELECT SUM(c.committed_amount - COALESCE(c.paid_amount, 0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID')), 0)
    - COALESCE((SELECT SUM(COALESCE(c.paid_amount, 0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status <> 'CANCELLED'), 0)
  )::NUMERIC(15,2) AS budget_available,
  (
    COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.budget_allocation_id = ba.id), 0)
    - COALESCE((SELECT SUM(c.committed_amount - COALESCE(c.paid_amount, 0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID')), 0)
    - COALESCE((SELECT SUM(COALESCE(c.paid_amount, 0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status <> 'CANCELLED'), 0)
  )::NUMERIC(15,2) AS released_available
FROM budget_allocations ba
LEFT JOIN departments d ON d.id = ba.department_id
LEFT JOIN sections s ON s.id = ba.section_id
LEFT JOIN cost_centres cc ON cc.id = ba.cost_centre_id
LEFT JOIN projects p ON p.id = ba.project_id
LEFT JOIN funding_sources fs ON fs.id = ba.funding_source_id
LEFT JOIN expense_code_registry ecr ON ecr.id = ba.expense_code_registry_id
WHERE ba.is_active = true;

COMMENT ON COLUMN budget_allocations.revision_adjustment IS
  'Signed approved non-supplementary budget adjustment. Current Revised Budget = Original + Supplementary + Revision Adjustment.';

COMMENT ON VIEW v_authoritative_budget_position IS
  'Authoritative operational budget position. budget_available is budget headroom; available_amount/released_available is released-cash headroom.';

GRANT SELECT ON v_authoritative_budget_position TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Revision history management report.
--    SECURITY INVOKER ensures the caller remains subject to revision/submission
--    RLS and the four-group data-scope rules.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_budget_revision_history_report
WITH (security_invoker = true) AS
SELECT
  r.id AS budget_revision_id,
  r.revision_number,
  r.budget_year,
  r.division_id,
  d.code AS division_code,
  d.name AS division_name,
  r.revision_type,
  r.status,
  r.reason,
  r.authority_reference,
  r.supporting_reference,
  r.effective_date,
  r.parent_submission_id,
  parent_submission.submission_number AS parent_submission_number,
  r.revision_submission_id,
  revision_submission.submission_number AS revision_submission_number,
  r.requested_by,
  r.requested_by_email,
  r.approved_by,
  r.created_at,
  r.approved_at,
  COUNT(brl.id)::INTEGER AS line_count,
  COALESCE(SUM(brl.original_budget), 0)::NUMERIC(15,2) AS original_budget,
  COALESCE(SUM(brl.current_revised_budget), 0)::NUMERIC(15,2) AS current_revised_budget_before,
  COALESCE(SUM(brl.adjustment_amount), 0)::NUMERIC(15,2) AS revision_adjustment,
  COALESCE(SUM(brl.proposed_revised_budget), 0)::NUMERIC(15,2) AS proposed_revised_budget,
  COALESCE(SUM(brl.actual_expenditure_at_submission), 0)::NUMERIC(15,2) AS actual_expenditure_at_submission,
  COALESCE(SUM(brl.outstanding_commitment_at_submission), 0)::NUMERIC(15,2) AS outstanding_commitment_at_submission,
  COALESCE(SUM(brl.protected_minimum_at_submission), 0)::NUMERIC(15,2) AS protected_minimum_at_submission,
  COALESCE(SUM(brl.actual_expenditure_at_approval), 0)::NUMERIC(15,2) AS actual_expenditure_at_approval,
  COALESCE(SUM(brl.outstanding_commitment_at_approval), 0)::NUMERIC(15,2) AS outstanding_commitment_at_approval,
  COALESCE(SUM(brl.protected_minimum_at_approval), 0)::NUMERIC(15,2) AS protected_minimum_at_approval
FROM budget_revisions r
JOIN budget_divisions d ON d.id = r.division_id
JOIN divisional_budget_submissions parent_submission ON parent_submission.id = r.parent_submission_id
JOIN divisional_budget_submissions revision_submission ON revision_submission.id = r.revision_submission_id
LEFT JOIN budget_revision_lines brl ON brl.budget_revision_id = r.id
GROUP BY
  r.id,
  r.revision_number,
  r.budget_year,
  r.division_id,
  d.code,
  d.name,
  r.revision_type,
  r.status,
  r.reason,
  r.authority_reference,
  r.supporting_reference,
  r.effective_date,
  r.parent_submission_id,
  parent_submission.submission_number,
  r.revision_submission_id,
  revision_submission.submission_number,
  r.requested_by,
  r.requested_by_email,
  r.approved_by,
  r.created_at,
  r.approved_at;

GRANT SELECT ON v_budget_revision_history_report TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Add the revision-history report to the existing report catalogue.
-- -----------------------------------------------------------------------------
INSERT INTO report_definitions (
  category_id,
  report_code,
  report_name,
  description,
  handler_key,
  sort_order,
  required_permission,
  allowed_export_formats,
  is_active
)
SELECT
  c.id,
  'budget-revision-history',
  'Budget Revision History',
  'Original, supplementary and approved revision movements with submission/approval financial snapshots.',
  'v_budget_revision_history_report',
  35,
  'budget.revision.report',
  ARRAY['pdf','excel','csv','print'],
  true
FROM report_categories c
WHERE c.code = 'budget'
ON CONFLICT (report_code) DO UPDATE SET
  category_id = EXCLUDED.category_id,
  report_name = EXCLUDED.report_name,
  description = EXCLUDED.description,
  handler_key = EXCLUDED.handler_key,
  sort_order = EXCLUDED.sort_order,
  required_permission = EXCLUDED.required_permission,
  allowed_export_formats = EXCLUDED.allowed_export_formats,
  is_active = true,
  updated_at = NOW();
