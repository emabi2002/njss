-- =====================================================
-- NJSS supplier workflow status alignment
-- The Phase 3 supplier workflow transitions through DRAFT,
-- PENDING_VERIFICATION, VERIFIED, APPROVED, REJECTED and SUSPENDED.
-- A legacy check constraint still allowed only ACTIVE/INACTIVE, making the
-- workflow internally inconsistent. This migration changes only the check
-- constraint; it does not rewrite supplier records.
-- =====================================================

ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS chk_suppliers_simple_status;

ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS chk_suppliers_phase3_status;

ALTER TABLE public.suppliers
  ADD CONSTRAINT chk_suppliers_phase3_status
  CHECK (
    status IN (
      'DRAFT',
      'PENDING_VERIFICATION',
      'VERIFIED',
      'APPROVED',
      'REJECTED',
      'SUSPENDED',
      'ACTIVE',
      'INACTIVE'
    )
  );

COMMENT ON CONSTRAINT chk_suppliers_phase3_status ON public.suppliers IS
  'Supplier lifecycle statuses used by njss_transition_supplier; ACTIVE/INACTIVE retained for legacy compatibility.';
