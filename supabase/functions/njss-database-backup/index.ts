import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

const ALLOWED_PERMISSIONS = new Set(["operations.manage", "settings.manage", "all"]);
const encoder = new TextEncoder();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition, X-NJSS-Backup-Id, X-NJSS-Backup-Type, X-NJSS-Backup-Filename",
};

type BackupType = "FULL" | "DIFFERENTIAL";
type CallerContext = { userId: string; email: string; name: string };
type FullSnapshot = {
  capturedAt: string;
  baselineChangeId: number;
  tableCount: number;
  totalRecords: number;
  recordCounts: Record<string, number>;
  tables: Record<string, unknown[]>;
};
type DifferentialSnapshot = {
  capturedAt: string;
  baselineChangeId: number;
  throughChangeId: number;
  changeCount: number;
  tablesAffected: string[];
  changes: unknown[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "_");
}

function safeFileToken(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_");
}

async function sha256(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authorize(req: Request, admin: SupabaseClient): Promise<CallerContext | Response> {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Authentication required" }, 401);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Authentication required" }, 401);

  const authUser = authData.user;
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id,email,full_name,is_active")
    .or(`auth_user_id.eq.${authUser.id},email.eq.${authUser.email || ""}`)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (profileError || !profile) return json({ error: "Active NJSS profile not found" }, 403);

  const { data: roleRows, error: roleError } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", profile.id);
  if (roleError) return json({ error: "Unable to resolve backup permissions" }, 500);
  const roleIds = (roleRows || []).map((row) => row.role_id).filter(Boolean);
  if (!roleIds.length) return json({ error: "Access denied" }, 403);

  const { data: permissionRows, error: permissionError } = await admin
    .from("role_permissions")
    .select("permission")
    .in("role_id", roleIds)
    .eq("is_allowed", true);
  if (permissionError) return json({ error: "Unable to resolve backup permissions" }, 500);

  const permissions = new Set((permissionRows || []).map((row) => row.permission));
  if (![...ALLOWED_PERMISSIONS].some((permission) => permissions.has(permission))) {
    return json({ error: "Backup administration permission required" }, 403);
  }

  return {
    userId: profile.id,
    email: profile.email || authUser.email || "",
    name: profile.full_name || authUser.email?.split("@")[0] || "Administrator",
  };
}

async function audit(admin: SupabaseClient, context: CallerContext, action: string, backupId: string, metadata: Record<string, unknown>) {
  const { error } = await admin.from("audit_logs").insert({
    user_id: context.userId,
    user_email: context.email,
    user_name: context.name,
    action,
    entity_type: "SYSTEM_BACKUP",
    entity_reference: backupId,
    metadata: { module: "HOUSEKEEPING", ...metadata },
  });
  if (error) console.error("Backup audit write failed", error.message);
}

async function migrationMarker(admin: SupabaseClient) {
  const { data } = await admin
    .from("system_settings")
    .select("setting_key,setting_value")
    .in("setting_key", ["latest_database_migration", "application_version"]);
  return Object.fromEntries((data || []).map((row) => [row.setting_key, row.setting_value]));
}

async function buildZip(files: Map<string, string>) {
  const checksums: Record<string, string> = {};
  for (const [name, content] of files) checksums[name] = await sha256(content);

  const zip = new JSZip();
  for (const [name, content] of files) zip.file(name, content);
  zip.file("checksums.json", JSON.stringify({ algorithm: "SHA-256", files: checksums }, null, 2));

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return { bytes, checksums, zipSha256: await sha256(bytes) };
}

async function registerStarted(
  admin: SupabaseClient,
  input: {
    backupId: string;
    backupType: BackupType;
    baselineBackupId?: string | null;
    baselineChangeId?: number;
    context: CallerContext;
  },
) {
  const { error } = await admin.from("system_backup_registry").insert({
    backup_id: input.backupId,
    backup_type: input.backupType,
    baseline_backup_id: input.baselineBackupId || null,
    baseline_change_id: input.baselineChangeId || 0,
    through_change_id: input.baselineChangeId || 0,
    status: "IN_PROGRESS",
    created_by_user_id: input.context.userId,
    created_by_email: input.context.email,
  });
  if (error) throw new Error(`Unable to register backup: ${error.message}`);
}

async function registerCompleted(
  admin: SupabaseClient,
  backupId: string,
  values: Record<string, unknown>,
) {
  const { error } = await admin
    .from("system_backup_registry")
    .update({ status: "COMPLETED", completed_at: new Date().toISOString(), ...values })
    .eq("backup_id", backupId);
  if (error) throw new Error(`Unable to complete backup registry: ${error.message}`);
}

async function registerFailed(admin: SupabaseClient, backupId: string, errorMessage: string) {
  await admin
    .from("system_backup_registry")
    .update({ status: "FAILED", completed_at: new Date().toISOString(), error_message: errorMessage.slice(0, 2000) })
    .eq("backup_id", backupId);
}

async function createFullBackup(admin: SupabaseClient, context: CallerContext) {
  const now = new Date();
  const backupId = `NJSS-FULL-${stamp(now)}-${crypto.randomUUID().slice(0, 8)}`;
  const filename = `NJSS_FULL_${stamp(now)}.zip`;
  await registerStarted(admin, { backupId, backupType: "FULL", context });

  try {
    await admin.rpc("njss_backup_refresh_change_triggers");
    const [{ data: snapshotData, error: snapshotError }, { data: schemaData, error: schemaError }, marker] = await Promise.all([
      admin.rpc("njss_backup_full_snapshot"),
      admin.rpc("njss_backup_schema_snapshot"),
      migrationMarker(admin),
    ]);
    if (snapshotError || !snapshotData) throw new Error(snapshotError?.message || "Full database snapshot returned no data");
    if (schemaError || !schemaData) throw new Error(schemaError?.message || "Schema snapshot returned no data");

    const snapshot = snapshotData as FullSnapshot;
    const files = new Map<string, string>();
    const tableNames = Object.keys(snapshot.tables || {}).sort();

    for (const tableName of tableNames) {
      const rows = snapshot.tables[tableName] || [];
      files.set(`tables/${safeFileToken(tableName)}.json`, JSON.stringify({ table: tableName, count: rows.length, rows }));
    }
    files.set("schema/public-schema.json", JSON.stringify(schemaData));
    files.set(
      "README.txt",
      "NJSS Full ZIP Backup. This is a complete logical backup of the NJSS application public-schema tables plus schema metadata. It is not a Supabase provider physical/PITR snapshot. Keep this file in an approved secure location.\n",
    );

    const manifest = {
      type: "NJSS_FULL_DATABASE_BACKUP",
      formatVersion: 1,
      backupClass: "LOGICAL_DATABASE_BACKUP",
      backupId,
      createdAt: snapshot.capturedAt || now.toISOString(),
      createdBy: context.email || context.name,
      baselineBackupId: backupId,
      baselineChangeId: Number(snapshot.baselineChangeId || 0),
      throughChangeId: Number(snapshot.baselineChangeId || 0),
      tableCount: Number(snapshot.tableCount || tableNames.length),
      totalRecords: Number(snapshot.totalRecords || 0),
      recordCounts: snapshot.recordCounts || {},
      tables: tableNames,
      databaseMarker: marker,
      scope: {
        schema: "public",
        excludes: ["system_backup_registry", "system_backup_change_log"],
        providerPhysicalSnapshot: false,
      },
    };
    files.set("manifest.json", JSON.stringify(manifest, null, 2));

    const { bytes, checksums, zipSha256 } = await buildZip(files);
    const completedManifest = { ...manifest, checksums };
    await registerCompleted(admin, backupId, {
      baseline_change_id: manifest.baselineChangeId,
      through_change_id: manifest.throughChangeId,
      file_name: filename,
      file_size_bytes: bytes.length,
      sha256: zipSha256,
      table_count: manifest.tableCount,
      record_count: manifest.totalRecords,
      change_count: 0,
      manifest: completedManifest,
    });
    await audit(admin, context, "HOUSEKEEPING_FULL_BACKUP_CREATED", backupId, {
      backupType: "FULL",
      filename,
      bytes: bytes.length,
      tableCount: manifest.tableCount,
      totalRecords: manifest.totalRecords,
      baselineChangeId: manifest.baselineChangeId,
      sha256: zipSha256,
    });

    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-NJSS-Backup-Id": backupId,
        "X-NJSS-Backup-Type": "FULL",
        "X-NJSS-Backup-Filename": filename,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Full backup failed";
    await registerFailed(admin, backupId, message);
    await audit(admin, context, "HOUSEKEEPING_FULL_BACKUP_FAILED", backupId, { backupType: "FULL", error: message });
    return json({ error: message }, 500);
  }
}

async function createDifferentialBackup(admin: SupabaseClient, context: CallerContext) {
  const { data: baseline, error: baselineError } = await admin
    .from("system_backup_registry")
    .select("backup_id,baseline_change_id,created_at")
    .eq("backup_type", "FULL")
    .eq("status", "COMPLETED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (baselineError) return json({ error: baselineError.message }, 500);
  if (!baseline) return json({ error: "A successful Full ZIP Backup is required before creating a Differential ZIP Backup." }, 409);

  const now = new Date();
  const backupId = `NJSS-DIFF-${stamp(now)}-${crypto.randomUUID().slice(0, 8)}`;
  const filename = `NJSS_DIFF_${stamp(now)}_FROM_${safeFileToken(baseline.backup_id)}.zip`;
  const baselineChangeId = Number(baseline.baseline_change_id || 0);
  await registerStarted(admin, {
    backupId,
    backupType: "DIFFERENTIAL",
    baselineBackupId: baseline.backup_id,
    baselineChangeId,
    context,
  });

  try {
    await admin.rpc("njss_backup_refresh_change_triggers");
    const [{ data: snapshotData, error: snapshotError }, marker] = await Promise.all([
      admin.rpc("njss_backup_differential_snapshot", { p_baseline_change_id: baselineChangeId }),
      migrationMarker(admin),
    ]);
    if (snapshotError || !snapshotData) throw new Error(snapshotError?.message || "Differential snapshot returned no data");

    const snapshot = snapshotData as DifferentialSnapshot;
    const files = new Map<string, string>();
    files.set("changes/change-log.json", JSON.stringify({
      baselineBackupId: baseline.backup_id,
      baselineChangeId,
      throughChangeId: Number(snapshot.throughChangeId || baselineChangeId),
      count: Number(snapshot.changeCount || 0),
      changes: snapshot.changes || [],
    }));
    files.set("schema/schema-version.json", JSON.stringify({ databaseMarker: marker, capturedAt: snapshot.capturedAt || now.toISOString() }, null, 2));
    files.set(
      "README.txt",
      `NJSS Differential ZIP Backup. This package contains all tracked row inserts, updates and deletes since Full Backup ${baseline.backup_id}. Restore requires that Full Backup as the baseline.\n`,
    );

    const manifest = {
      type: "NJSS_DIFFERENTIAL_DATABASE_BACKUP",
      formatVersion: 1,
      backupClass: "LOGICAL_DATABASE_DIFFERENTIAL",
      backupId,
      createdAt: snapshot.capturedAt || now.toISOString(),
      createdBy: context.email || context.name,
      baselineBackupId: baseline.backup_id,
      baselineCreatedAt: baseline.created_at,
      baselineChangeId,
      throughChangeId: Number(snapshot.throughChangeId || baselineChangeId),
      changeCount: Number(snapshot.changeCount || 0),
      tablesAffected: snapshot.tablesAffected || [],
      databaseMarker: marker,
    };
    files.set("manifest.json", JSON.stringify(manifest, null, 2));

    const { bytes, checksums, zipSha256 } = await buildZip(files);
    const completedManifest = { ...manifest, checksums };
    await registerCompleted(admin, backupId, {
      baseline_backup_id: baseline.backup_id,
      baseline_change_id: baselineChangeId,
      through_change_id: manifest.throughChangeId,
      file_name: filename,
      file_size_bytes: bytes.length,
      sha256: zipSha256,
      table_count: manifest.tablesAffected.length,
      record_count: null,
      change_count: manifest.changeCount,
      manifest: completedManifest,
    });
    await audit(admin, context, "HOUSEKEEPING_DIFFERENTIAL_BACKUP_CREATED", backupId, {
      backupType: "DIFFERENTIAL",
      filename,
      bytes: bytes.length,
      baselineBackupId: baseline.backup_id,
      baselineChangeId,
      throughChangeId: manifest.throughChangeId,
      changeCount: manifest.changeCount,
      sha256: zipSha256,
    });

    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-NJSS-Backup-Id": backupId,
        "X-NJSS-Backup-Type": "DIFFERENTIAL",
        "X-NJSS-Backup-Filename": filename,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Differential backup failed";
    await registerFailed(admin, backupId, message);
    await audit(admin, context, "HOUSEKEEPING_DIFFERENTIAL_BACKUP_FAILED", backupId, { backupType: "DIFFERENTIAL", error: message });
    return json({ error: message }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Backup service is not configured" }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const context = await authorize(req, admin);
  if (context instanceof Response) return context;

  const body = await req.json().catch(() => ({})) as { backupType?: BackupType };
  if (body.backupType === "FULL") return createFullBackup(admin, context);
  if (body.backupType === "DIFFERENTIAL") return createDifferentialBackup(admin, context);
  return json({ error: "backupType must be FULL or DIFFERENTIAL" }, 400);
});
