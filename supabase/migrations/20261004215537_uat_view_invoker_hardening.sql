-- Enforce caller RLS on legacy client-readable views. Definitions and grants are unchanged.
ALTER VIEW public.v_budget_approved_lines SET (security_invoker = true);
ALTER VIEW public.v_supplier_document_expiry_buckets SET (security_invoker = true);
ALTER VIEW public.v_audit_entity_types SET (security_invoker = true);
ALTER VIEW public.v_audit_actions SET (security_invoker = true);
ALTER VIEW public.v_budget_import_validation SET (security_invoker = true);
ALTER VIEW public.v_budget_submission_summary SET (security_invoker = true);
ALTER VIEW public.v_budget_template_lines SET (security_invoker = true);
ALTER VIEW public.v_budget_monthly_cashflow SET (security_invoker = true);
ALTER VIEW public.v_budget_validation_summary SET (security_invoker = true);
ALTER VIEW public.v_user_effective_permissions SET (security_invoker = true);
