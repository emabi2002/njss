-- =============================================================================
-- NJSS 059 — TASK 9 FINANCE / POSTING ONE-TO-ONE INTEGRITY
-- Makes the canonical active Finance Code <-> Posting Code relationship unique
-- at the database layer, not only in the administration RPC or activation scan.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT ecr.expense_ledger_id
    FROM expense_code_registry ecr
    WHERE ecr.expense_ledger_id IS NOT NULL
      AND ecr.is_active = true
    GROUP BY ecr.expense_ledger_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active Posting Code mappings exist for a Finance Code. Resolve the duplicate mappings before applying Task 9 integrity controls.';
  END IF;

  IF EXISTS (
    SELECT el.expense_code_registry_id
    FROM expense_ledger el
    WHERE el.expense_code_registry_id IS NOT NULL
      AND el.is_active = true
    GROUP BY el.expense_code_registry_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active Finance Code mappings exist for a Posting Code. Resolve the duplicate mappings before applying Task 9 integrity controls.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_expense_code_registry_active_expense_ledger
  ON expense_code_registry(expense_ledger_id)
  WHERE expense_ledger_id IS NOT NULL AND is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_expense_ledger_active_expense_code_registry
  ON expense_ledger(expense_code_registry_id)
  WHERE expense_code_registry_id IS NOT NULL AND is_active = true;

COMMENT ON INDEX ux_expense_code_registry_active_expense_ledger IS
  'Task 9: one active Posting Code may map to a Finance Code and each active Finance Code may have only one active Posting Code.';

COMMENT ON INDEX ux_expense_ledger_active_expense_code_registry IS
  'Task 9: one active Finance Code may reference a Posting Code and an active Posting Code may be referenced by only one active Finance Code.';

COMMIT;
