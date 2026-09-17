-- NJSS Organisation Setup safe-delete control.
-- Permanent deletion is reserved for System Administrator and is allowed only
-- when the Division or Section / Unit has no foreign-key references anywhere
-- in the NJSS public schema. Historical/financial records are never cascaded.

CREATE OR REPLACE FUNCTION public.njss_delete_organisation_record(
  p_record_type text,
  p_record_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_record_type text := upper(trim(COALESCE(p_record_type, '')));
  v_target regclass;
  v_old_record jsonb;
  v_reference text;
  v_entity_type text;
  v_ref record;
  v_reference_count bigint;
  v_total_references bigint := 0;
  v_usage jsonb := '[]'::jsonb;
  v_user_id uuid;
  v_user_email varchar(255);
  v_user_name varchar(255);
BEGIN
  -- Permanent deletion is intentionally stricter than ordinary master-data
  -- maintenance. Only the System Administrator wildcard role can use it.
  PERFORM public.njss_require_permission('all');

  IF p_record_id IS NULL THEN
    RAISE EXCEPTION 'Organisation record id is required';
  END IF;

  IF v_record_type = 'DIVISION' THEN
    v_target := 'public.departments'::regclass;
    v_entity_type := 'ORGANISATION_DIVISION';

    SELECT to_jsonb(d), d.code
      INTO v_old_record, v_reference
    FROM public.departments d
    WHERE d.id = p_record_id
    FOR UPDATE;
  ELSIF v_record_type = 'SECTION' THEN
    v_target := 'public.sections'::regclass;
    v_entity_type := 'ORGANISATION_SECTION';

    SELECT to_jsonb(s), s.code
      INTO v_old_record, v_reference
    FROM public.sections s
    WHERE s.id = p_record_id
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Unsupported organisation record type: %', p_record_type;
  END IF;

  IF v_old_record IS NULL THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'blocked', false,
      'message', 'Organisation record was not found.'
    );
  END IF;

  -- Inspect the live FK catalogue rather than maintaining a fragile hand-picked
  -- list. Any current reference blocks deletion, including relationships whose
  -- FK action would otherwise SET NULL.
  FOR v_ref IN
    SELECT
      ns.nspname AS schema_name,
      rel.relname AS table_name,
      att.attname AS column_name
    FROM pg_constraint c
    JOIN pg_class rel
      ON rel.oid = c.conrelid
    JOIN pg_namespace ns
      ON ns.oid = rel.relnamespace
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS source_key(attnum, ord)
      ON true
    JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS target_key(attnum, ord)
      ON target_key.ord = source_key.ord
    JOIN pg_attribute att
      ON att.attrelid = c.conrelid
     AND att.attnum = source_key.attnum
    WHERE c.contype = 'f'
      AND c.confrelid = v_target
      AND ns.nspname = 'public'
      AND array_length(c.conkey, 1) = 1
      AND array_length(c.confkey, 1) = 1
    ORDER BY rel.relname, att.attname
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I WHERE %I = $1',
      v_ref.schema_name,
      v_ref.table_name,
      v_ref.column_name
    )
    INTO v_reference_count
    USING p_record_id;

    IF v_reference_count > 0 THEN
      v_total_references := v_total_references + v_reference_count;
      v_usage := v_usage || jsonb_build_array(
        jsonb_build_object(
          'table', v_ref.table_name,
          'column', v_ref.column_name,
          'count', v_reference_count
        )
      );
    END IF;
  END LOOP;

  IF v_total_references > 0 THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'blocked', true,
      'message',
        CASE
          WHEN v_record_type = 'DIVISION'
            THEN format('Cannot delete this Division because %s dependent record(s) still use it.', v_total_references)
          ELSE format('Cannot delete this Section / Unit because %s dependent record(s) still use it.', v_total_references)
        END,
      'reference_count', v_total_references,
      'usage', v_usage
    );
  END IF;

  -- Resolve the application user for the permanent-delete audit record.
  SELECT u.id, u.email, u.full_name
    INTO v_user_id, v_user_email, v_user_name
  FROM public.users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_record_type = 'DIVISION' THEN
    DELETE FROM public.departments
    WHERE id = p_record_id;
  ELSE
    DELETE FROM public.sections
    WHERE id = p_record_id;
  END IF;

  PERFORM public.log_audit_event(
    v_user_id,
    v_user_email,
    COALESCE(v_user_name, 'System Administrator'),
    'DELETE',
    v_entity_type,
    p_record_id,
    v_reference,
    v_old_record,
    NULL,
    jsonb_build_object(
      'permanent_delete', true,
      'record_type', v_record_type,
      'usage_check', 'zero_foreign_key_references'
    ),
    jsonb_build_object(
      'source', 'Organisation Setup',
      'guard', 'System Administrator + zero references'
    )
  );

  RETURN jsonb_build_object(
    'deleted', true,
    'blocked', false,
    'message',
      CASE
        WHEN v_record_type = 'DIVISION' THEN 'Division permanently deleted.'
        ELSE 'Section / Unit permanently deleted.'
      END,
    'record_type', v_record_type,
    'record_id', p_record_id,
    'reference', v_reference
  );
END;
$function$;

-- Prevent callers from bypassing the guarded RPC with a direct table DELETE.
REVOKE DELETE ON TABLE public.departments, public.sections FROM authenticated;

REVOKE ALL ON FUNCTION public.njss_delete_organisation_record(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.njss_delete_organisation_record(text, uuid)
  TO authenticated;
