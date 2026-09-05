-- =============================================================================
-- NJSS HARD-09/24 — FF4 REGISTRAR APPROVAL AUTHORITY
-- Additive migration. Does not rewrite historical migration 045.
--
-- Approved four-group responsibility:
--   Payment/Reconciliation Officer: create, submit, verify, process, reconcile.
--   Registrar: organisation-wide business approval, including VERIFIED FF4.
--   System Administrator: technical role only; 'all' remains an emergency/admin
--   capability but is not the normal business approver.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions
    WHERE code = 'ff4.approve' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Required permission ff4.approve is missing or inactive.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.roles
    WHERE name = 'Registrar'
      AND is_active = true
      AND is_business_role = true
      AND is_protected = true
  ) THEN
    RAISE EXCEPTION 'Active protected Registrar business role is required.';
  END IF;
END
$$;

-- Registrar receives the existing FF4 approval permission without replacing its
-- other permissions.
INSERT INTO public.role_permissions (role_id, permission, is_allowed)
SELECT r.id, 'ff4.approve', true
FROM public.roles r
WHERE r.name = 'Registrar'
  AND r.is_active = true
ON CONFLICT (role_id, permission)
DO UPDATE SET is_allowed = true;

-- Payment/Reconciliation Officer must never hold ff4.approve; DELETE any drift
-- so verification/processing/reconciliation remain segregated from approval.
DELETE FROM public.role_permissions rp
USING public.roles r
WHERE rp.role_id = r.id
  AND r.name = 'Payment/Reconciliation Officer'
  AND rp.permission = 'ff4.approve';

-- No inactive/legacy business role should accidentally retain active approval.
UPDATE public.role_permissions rp
SET is_allowed = false
FROM public.roles r
WHERE rp.role_id = r.id
  AND rp.permission = 'ff4.approve'
  AND r.name NOT IN ('Registrar', 'System Administrator')
  AND r.is_active = false;

DO $$
DECLARE
  v_registrar_has_approval boolean;
  v_payment_has_approval boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    WHERE r.name = 'Registrar'
      AND r.is_active = true
      AND rp.permission = 'ff4.approve'
      AND rp.is_allowed = true
  ) INTO v_registrar_has_approval;

  SELECT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    WHERE r.name = 'Payment/Reconciliation Officer'
      AND r.is_active = true
      AND rp.permission = 'ff4.approve'
      AND rp.is_allowed = true
  ) INTO v_payment_has_approval;

  IF NOT v_registrar_has_approval THEN
    RAISE EXCEPTION 'FF4 hardening failed: Registrar lacks ff4.approve.';
  END IF;

  IF v_payment_has_approval THEN
    RAISE EXCEPTION 'FF4 hardening failed: Payment/Reconciliation Officer must not approve FF4.';
  END IF;
END
$$;
