-- =============================================================================
-- NJSS 051 — BUDGET REVISION / REFORECAST SCHEMA AND RBAC
-- Additive revision framework. Approved budget history and transaction links remain intact.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Preserve accounting meaning: supplementary funding is not a generic revision.
-- -----------------------------------------------------------------------------
ALTER TABLE budget_allocations
  ADD COLUMN IF NOT EXISTS revision_adjustment NUMERIC(15,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'budget_allocations'
      AND column_name = 'revised_budget'
      AND is_generated = 'ALWAYS'
  ) THEN
    EXECUTE 'ALTER TABLE budget_allocations ALTER COLUMN revised_budget DROP EXPRESSION';
  END IF;
END $$;

UPDATE budget_allocations
SET revised_budget = COALESCE(original_budget, 0)
                   + COALESCE(supplemental_budget, 0)
                   + COALESCE(revision_adjustment, 0);

CREATE OR REPLACE FUNCTION njss_sync_revised_budget()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.revised_budget := COALESCE(NEW.original_budget, 0)
                      + COALESCE(NEW.supplemental_budget, 0)
                      + COALESCE(NEW.revision_adjustment, 0);
  IF NEW.revised_budget < 0 THEN
    RAISE EXCEPTION 'Current revised budget cannot be negative.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budget_allocations_sync_revised_insert ON budget_allocations;
CREATE TRIGGER trg_budget_allocations_sync_revised_insert
  BEFORE INSERT ON budget_allocations
  FOR EACH ROW EXECUTE FUNCTION njss_sync_revised_budget();

DROP TRIGGER IF EXISTS trg_budget_allocations_sync_revised_update ON budget_allocations;
CREATE TRIGGER trg_budget_allocations_sync_revised_update
  BEFORE UPDATE OF original_budget, supplemental_budget, revision_adjustment ON budget_allocations
  FOR EACH ROW EXECUTE FUNCTION njss_sync_revised_budget();

ALTER TABLE budget_allocations
  DROP CONSTRAINT IF EXISTS chk_budget_allocations_revised_nonnegative;
ALTER TABLE budget_allocations
  ADD CONSTRAINT chk_budget_allocations_revised_nonnegative
  CHECK (COALESCE(revised_budget, 0) >= 0) NOT VALID;

COMMENT ON COLUMN budget_allocations.revision_adjustment IS
  'Signed approved non-supplementary budget movement: virement, reduction, reclassification or annual-value reforecast. Genuine supplementary funding remains in supplemental_budget.';

-- -----------------------------------------------------------------------------
-- 2. Revision header and line-level financial snapshots.
-- -----------------------------------------------------------------------------
CREATE TABLE budget_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_number VARCHAR(80) NOT NULL UNIQUE,
  parent_submission_id UUID NOT NULL REFERENCES divisional_budget_submissions(id) ON DELETE RESTRICT,
  revision_submission_id UUID NOT NULL UNIQUE REFERENCES divisional_budget_submissions(id) ON DELETE RESTRICT,
  budget_year INTEGER NOT NULL,
  division_id UUID NOT NULL REFERENCES budget_divisions(id) ON DELETE RESTRICT,
  revision_type VARCHAR(40) NOT NULL CHECK (revision_type IN ('VIREMENT','SUPPLEMENTARY','REDUCTION','RECLASSIFICATION','REFORECAST')),
  reason TEXT NOT NULL,
  authority_reference VARCHAR(180),
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(40) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','REVIEWED','APPROVED','REJECTED','ARCHIVED')),
  requested_by UUID REFERENCES users(id),
  requested_by_email VARCHAR(255),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  supporting_reference VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE budget_revision_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_revision_id UUID NOT NULL REFERENCES budget_revisions(id) ON DELETE RESTRICT,
  source_budget_allocation_id UUID REFERENCES budget_allocations(id) ON DELETE RESTRICT,
  source_budget_line_id UUID REFERENCES divisional_budget_lines(id) ON DELETE RESTRICT,
  revision_budget_line_id UUID NOT NULL REFERENCES divisional_budget_lines(id) ON DELETE RESTRICT,
  original_budget NUMERIC(15,2) NOT NULL DEFAULT 0,
  current_revised_budget NUMERIC(15,2) NOT NULL DEFAULT 0,
  actual_expenditure_at_submission NUMERIC(15,2),
  outstanding_commitment_at_submission NUMERIC(15,2),
  protected_minimum_at_submission NUMERIC(15,2),
  actual_expenditure_at_approval NUMERIC(15,2),
  outstanding_commitment_at_approval NUMERIC(15,2),
  protected_minimum_at_approval NUMERIC(15,2),
  proposed_revised_budget NUMERIC(15,2) NOT NULL DEFAULT 0,
  adjustment_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  adjustment_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (budget_revision_id, revision_budget_line_id)
);

CREATE INDEX idx_budget_revisions_submission ON budget_revisions(revision_submission_id);
CREATE INDEX idx_budget_revisions_division_year ON budget_revisions(division_id, budget_year);
CREATE INDEX idx_budget_revision_lines_revision ON budget_revision_lines(budget_revision_id);
CREATE INDEX idx_budget_revision_lines_source_allocation ON budget_revision_lines(source_budget_allocation_id);

CREATE UNIQUE INDEX ux_budget_revisions_one_active_parent
ON budget_revisions(parent_submission_id)
WHERE status IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','REVIEWED');

CREATE OR REPLACE FUNCTION njss_touch_budget_revision_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_budget_revisions_touch
  BEFORE UPDATE ON budget_revisions
  FOR EACH ROW EXECUTE FUNCTION njss_touch_budget_revision_updated_at();

CREATE TRIGGER trg_budget_revision_lines_touch
  BEFORE UPDATE ON budget_revision_lines
  FOR EACH ROW EXECUTE FUNCTION njss_touch_budget_revision_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Revision permissions and additive four-group role mapping.
--    Database module FKs use the live `budget` and `reports` module codes.
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module_code, menu_code, action, label, description, is_active) VALUES
  ('budget.revision.view',    'budget',  'budget.template', 'view',    'View budget revisions',        'View budget revision and reforecast records within authorised scope.', true),
  ('budget.revision.create',  'budget',  'budget.template', 'create',  'Create budget revisions',      'Create a revision from the current approved budget version.', true),
  ('budget.revision.edit',    'budget',  'budget.template', 'edit',    'Edit budget revision drafts',  'Edit controlled revision draft lines and future cashflow.', true),
  ('budget.revision.submit',  'budget',  'budget.template', 'submit',  'Submit budget revisions',      'Submit or resubmit a controlled budget revision.', true),
  ('budget.revision.review',  'budget',  'budget.template', 'verify',  'Review budget revisions',      'Review submitted budget revisions.', true),
  ('budget.revision.approve', 'budget',  'budget.template', 'approve', 'Approve budget revisions',     'Approve a reviewed revision as the new authoritative budget version.', true),
  ('budget.revision.reject',  'budget',  'budget.template', 'reject',  'Reject budget revisions',      'Reject a submitted or reviewed budget revision.', true),
  ('budget.revision.return',  'budget',  'budget.template', 'edit',    'Return budget revisions',      'Return a submitted budget revision to the Line Supervisor.', true),
  ('budget.revision.report',  'reports', 'reports.library', 'view',    'View budget revision reports', 'View revision history and reporting within authorised scope.', true)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  menu_code = EXCLUDED.menu_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = true;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.permission, true
FROM roles r
JOIN LATERAL (
  SELECT permission
  FROM (VALUES
    ('Requisition Officer', 'budget.revision.view'),
    ('Line Supervisor', 'budget.revision.view'),
    ('Line Supervisor', 'budget.revision.create'),
    ('Line Supervisor', 'budget.revision.edit'),
    ('Line Supervisor', 'budget.revision.submit'),
    ('Line Supervisor', 'budget.revision.report'),
    ('Registrar', 'budget.revision.view'),
    ('Registrar', 'budget.revision.review'),
    ('Registrar', 'budget.revision.approve'),
    ('Registrar', 'budget.revision.reject'),
    ('Registrar', 'budget.revision.return'),
    ('Registrar', 'budget.revision.report'),
    ('Payment/Reconciliation Officer', 'budget.revision.view'),
    ('Payment/Reconciliation Officer', 'budget.revision.report')
  ) AS x(role_name, permission)
  WHERE x.role_name = r.name
) p ON true
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

-- -----------------------------------------------------------------------------
-- 4. Read-only RLS. Mutations are deliberately reserved for guarded RPCs.
-- -----------------------------------------------------------------------------
ALTER TABLE budget_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_revision_lines ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON budget_revisions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON budget_revision_lines FROM anon, authenticated;
GRANT SELECT ON budget_revisions TO authenticated;
GRANT SELECT ON budget_revision_lines TO authenticated;

DROP POLICY IF EXISTS budget_revisions_select_revision_rbac ON budget_revisions;
CREATE POLICY budget_revisions_select_revision_rbac ON budget_revisions
FOR SELECT USING (
  (SELECT fn_current_user_has_permission('all'))
  OR (
    (
      (SELECT fn_current_user_has_permission('budget.revision.view'))
      OR (SELECT fn_current_user_has_permission('budget.revision.report'))
    )
    AND EXISTS (
      SELECT 1
      FROM budget_divisions d
      WHERE d.id = budget_revisions.division_id
        AND fn_current_user_data_scope_allows(
          d.department_id,
          d.section_id,
          budget_revisions.requested_by,
          NULL,
          NULL
        )
    )
  )
);

DROP POLICY IF EXISTS budget_revision_lines_select_revision_rbac ON budget_revision_lines;
CREATE POLICY budget_revision_lines_select_revision_rbac ON budget_revision_lines
FOR SELECT USING (
  (SELECT fn_current_user_has_permission('all'))
  OR (
    (
      (SELECT fn_current_user_has_permission('budget.revision.view'))
      OR (SELECT fn_current_user_has_permission('budget.revision.report'))
    )
    AND EXISTS (
      SELECT 1
      FROM budget_revisions br
      JOIN budget_divisions d ON d.id = br.division_id
      WHERE br.id = budget_revision_lines.budget_revision_id
        AND fn_current_user_data_scope_allows(
          d.department_id,
          d.section_id,
          br.requested_by,
          NULL,
          NULL
        )
    )
  )
);

-- New financial tables must participate in the existing differential backup framework.
DO $$
BEGIN
  IF to_regprocedure('public.njss_backup_refresh_change_triggers()') IS NOT NULL THEN
    PERFORM public.njss_backup_refresh_change_triggers();
  END IF;
END $$;
