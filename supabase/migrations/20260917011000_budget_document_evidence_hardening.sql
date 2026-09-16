-- =============================================================================
-- NJSS SIMPLIFIED BUDGET DOCUMENT EVIDENCE HARDENING
-- Ensures controlled document metadata can only be registered for an object
-- that already exists in the private NJSS budget bucket, and validates version
-- lineage before a document is allowed to supersede another record.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_budget_document(
  p_financial_year integer,
  p_division_budget_id uuid,
  p_related_entity_type text,
  p_related_entity_id uuid,
  p_document_type text,
  p_reference_number text,
  p_document_date date,
  p_description text,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_supersedes_document_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_document_id uuid;
  v_version integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.documents.manage');

  IF p_storage_path IS NULL OR trim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'Storage path is required';
  END IF;
  IF p_original_filename IS NULL OR trim(p_original_filename) = '' THEN
    RAISE EXCEPTION 'Original filename is required';
  END IF;

  -- Documentary evidence is authoritative only when the binary object already
  -- exists in the private controlled bucket. Metadata alone must never satisfy
  -- a Division-lock or annual-activation evidence requirement.
  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'njss-budget-documents'
      AND o.name = p_storage_path
  ) THEN
    RAISE EXCEPTION 'Budget document upload not found in private storage';
  END IF;

  IF p_document_type = 'OFFICIAL_APPROVED_BUDGET' THEN
    IF p_division_budget_id IS NULL
       OR p_related_entity_type <> 'DIVISION_BUDGET'
       OR p_related_entity_id IS DISTINCT FROM p_division_budget_id THEN
      RAISE EXCEPTION 'Official approved budget documents must be linked to the same Division budget';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.division_budgets
      WHERE id = p_division_budget_id
        AND financial_year = p_financial_year
    ) THEN
      RAISE EXCEPTION 'Division budget/document financial year mismatch';
    END IF;
  ELSIF p_document_type = 'REGISTRAR_ACTIVATION_AUTHORITY' THEN
    IF p_related_entity_type <> 'ANNUAL_BUDGET_CYCLE' OR p_related_entity_id IS NULL THEN
      RAISE EXCEPTION 'Activation authority must be linked to an annual budget cycle';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.annual_budget_cycles
      WHERE id = p_related_entity_id
        AND financial_year = p_financial_year
    ) THEN
      RAISE EXCEPTION 'Annual cycle/document financial year mismatch';
    END IF;
  END IF;

  -- Corrected documents form a strict lineage. A caller cannot make an
  -- unrelated document appear to be the predecessor of this controlled record.
  IF p_supersedes_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.budget_documents d
    WHERE d.id = p_supersedes_document_id
      AND d.financial_year = p_financial_year
      AND d.related_entity_type = p_related_entity_type
      AND d.related_entity_id IS NOT DISTINCT FROM p_related_entity_id
      AND d.document_type = p_document_type
  ) THEN
    RAISE EXCEPTION 'Superseded budget document does not belong to the same controlled document lineage';
  END IF;

  SELECT coalesce(max(version_number), 0) + 1
  INTO v_version
  FROM public.budget_documents
  WHERE financial_year = p_financial_year
    AND related_entity_type = p_related_entity_type
    AND related_entity_id IS NOT DISTINCT FROM p_related_entity_id
    AND document_type = p_document_type;

  INSERT INTO public.budget_documents (
    financial_year,
    division_budget_id,
    related_entity_type,
    related_entity_id,
    document_type,
    reference_number,
    document_date,
    description,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    version_number,
    supersedes_document_id,
    uploaded_by
  ) VALUES (
    p_financial_year,
    p_division_budget_id,
    p_related_entity_type,
    p_related_entity_id,
    p_document_type,
    NULLIF(trim(p_reference_number), ''),
    p_document_date,
    NULLIF(trim(p_description), ''),
    'njss-budget-documents',
    p_storage_path,
    p_original_filename,
    p_mime_type,
    v_version,
    p_supersedes_document_id,
    auth.uid()
  )
  RETURNING id INTO v_document_id;

  RETURN v_document_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.register_budget_document(integer, uuid, text, uuid, text, text, date, text, text, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_budget_document(integer, uuid, text, uuid, text, text, date, text, text, text, text, uuid)
  TO authenticated;

DO $verify$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.register_budget_document(integer,uuid,text,uuid,text,text,date,text,text,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anonymous users must not register controlled budget documents';
  END IF;
END
$verify$;
