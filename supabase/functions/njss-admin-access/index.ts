import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SYSTEM_ADMINISTRATOR = "System Administrator";

const ACTION_PERMISSIONS: Record<string, string> = {
  UPDATE_ROLE: "roles.manage",
  SET_ROLE_PERMISSIONS: "permissions.manage",
  TOGGLE_ROLE_PERMISSION: "permissions.manage",
  GRANT_USER_PERMISSION: "permissions.manage",
  REVOKE_USER_PERMISSION: "permissions.manage",
  SAVE_MODULE: "modules.manage",
  DELETE_MODULE: "modules.manage",
  SAVE_MENU: "modules.manage",
  DELETE_MENU: "modules.manage",
  SAVE_ROLE_SCOPE: "data_scope.manage",
  SAVE_USER_SCOPE: "data_scope.manage",
  REVOKE_USER_SCOPE: "data_scope.manage",
};

type Actor = {
  userId: string;
  email: string | null;
  name: string | null;
  permissions: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fail(message: string, status = 400) {
  return json({ error: message }, status);
}

async function audit(
  admin: SupabaseClient,
  actor: Actor | null,
  req: Request,
  input: {
    action: string;
    entityType: string;
    entityId?: string | null;
    entityReference?: string | null;
    oldValues?: unknown;
    newValues?: unknown;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await admin.from("audit_logs").insert({
      user_id: actor?.userId || null,
      user_email: actor?.email || null,
      user_name: actor?.name || null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId || null,
      entity_reference: input.entityReference || null,
      old_values: input.oldValues ?? null,
      new_values: input.newValues ?? null,
      ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      user_agent: req.headers.get("user-agent"),
      metadata: input.metadata ?? null,
    });
  } catch (error) {
    console.error("Access audit write failed", error);
  }
}

async function resolveActor(admin: SupabaseClient, token: string): Promise<Actor | null> {
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return null;

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id,email,full_name,is_active")
    .eq("auth_user_id", authData.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (profileError || !profile) return null;

  const { data: userRoles, error: roleError } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", profile.id);
  if (roleError) return null;

  const roleIds = (userRoles || []).map((row) => row.role_id).filter(Boolean);
  let permissions: string[] = [];
  if (roleIds.length) {
    const { data: rows, error: permissionError } = await admin
      .from("role_permissions")
      .select("permission")
      .eq("is_allowed", true)
      .in("role_id", roleIds);
    if (permissionError) return null;
    permissions = Array.from(new Set((rows || []).map((row) => row.permission)));
  }

  return {
    userId: profile.id,
    email: profile.email || authData.user.email || null,
    name: profile.full_name || authData.user.email?.split("@")[0] || null,
    permissions,
  };
}

function can(actor: Actor, permission: string) {
  return actor.permissions.includes('all') || actor.permissions.includes(permission);
}

async function roleById(admin: SupabaseClient, roleId: string) {
  const { data, error } = await admin.from("roles").select("*").eq("id", roleId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function assertPermissionCode(admin: SupabaseClient, permission: string) {
  const { data, error } = await admin
    .from("permissions")
    .select("code,is_active")
    .eq("code", permission)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.is_active) throw new Error(`Unknown or inactive permission: ${permission}`);
}

async function updateRole(admin: SupabaseClient, actor: Actor, req: Request, body: Record<string, unknown>) {
  const roleId = String(body.roleId || "");
  if (!roleId) return fail("roleId is required.");
  const before = await roleById(admin, roleId);
  if (!before) return fail("Role not found", 404);

  const requestedScope = body.dataScopeType === undefined ? undefined : String(body.dataScopeType);
  if (before.name === SYSTEM_ADMINISTRATOR && requestedScope && requestedScope !== "SYSTEM_WIDE") {
    return fail("System Administrator must retain SYSTEM_WIDE data scope.", 409);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.description !== undefined) patch.description = String(body.description || "") || null;
  if (requestedScope !== undefined) patch.data_scope_type = requestedScope;
  if (!before.is_protected) {
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.isActive !== undefined) patch.is_active = Boolean(body.isActive);
  }

  const { data: updated, error } = await admin.from("roles").update(patch).eq("id", roleId).select().single();
  if (error) return fail(error.message);

  if (requestedScope !== undefined) {
    const { error: scopeError } = await admin
      .from("role_data_scopes")
      .upsert({ role_id: roleId, scope_type: requestedScope }, { onConflict: "role_id,scope_type" });
    if (scopeError) return fail(scopeError.message);
  }

  await audit(admin, actor, req, {
    action: "ROLE_UPDATED",
    entityType: "ROLE",
    entityId: roleId,
    entityReference: updated.name,
    oldValues: before,
    newValues: updated,
  });
  return json({ role: updated });
}

async function setRolePermissions(admin: SupabaseClient, actor: Actor, req: Request, body: Record<string, unknown>) {
  const roleId = String(body.roleId || "");
  const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
  if (!roleId) return fail("roleId is required.");
  const role = await roleById(admin, roleId);
  if (!role) return fail("Role not found", 404);

  if (role.name === SYSTEM_ADMINISTRATOR && !permissions.includes("all")) {
    return fail("System Administrator cannot lose the all permission.", 409);
  }
  if (role.name !== SYSTEM_ADMINISTRATOR && permissions.includes("all")) {
    return fail("The all permission is reserved for System Administrator.", 409);
  }
  for (const permission of permissions) {
    if (permission !== "all") await assertPermissionCode(admin, permission);
  }

  const { data: before } = await admin
    .from("role_permissions")
    .select("permission")
    .eq("role_id", roleId)
    .eq("is_allowed", true);

  const { error: deleteError } = await admin.from("role_permissions").delete().eq("role_id", roleId);
  if (deleteError) return fail(deleteError.message);
  if (permissions.length) {
    const { error: insertError } = await admin
      .from("role_permissions")
      .insert(permissions.map((permission) => ({ role_id: roleId, permission, is_allowed: true })));
    if (insertError) return fail(insertError.message);
  }

  await audit(admin, actor, req, {
    action: "ROLE_PERMISSIONS_CHANGED",
    entityType: "ROLE",
    entityId: roleId,
    entityReference: role.name,
    oldValues: { permissions: (before || []).map((row) => row.permission) },
    newValues: { permissions },
  });
  return json({ ok: true });
}

async function toggleRolePermission(admin: SupabaseClient, actor: Actor, req: Request, body: Record<string, unknown>) {
  const roleId = String(body.roleId || "");
  const permission = String(body.permission || "");
  const grant = Boolean(body.grant);
  if (!roleId || !permission) return fail("roleId and permission are required.");
  const role = await roleById(admin, roleId);
  if (!role) return fail("Role not found", 404);

  if (permission === "all") {
    if (role.name === SYSTEM_ADMINISTRATOR && !grant) return fail("System Administrator cannot lose the all permission.", 409);
    if (role.name !== SYSTEM_ADMINISTRATOR && grant) return fail("The all permission is reserved for System Administrator.", 409);
  } else {
    try {
      await assertPermissionCode(admin, permission);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Invalid permission.");
    }
  }

  if (grant) {
    const { error } = await admin
      .from("role_permissions")
      .upsert({ role_id: roleId, permission, is_allowed: true }, { onConflict: "role_id,permission" });
    if (error) return fail(error.message);
  } else {
    const { error } = await admin
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId)
      .eq("permission", permission);
    if (error) return fail(error.message);
  }

  await audit(admin, actor, req, {
    action: grant ? "PERMISSION_GRANTED" : "PERMISSION_REVOKED",
    entityType: "ROLE",
    entityId: roleId,
    entityReference: role.name,
    newValues: { permission, granted: grant },
  });
  return json({ ok: true });
}

async function grantUserPermission(admin: SupabaseClient, actor: Actor, req: Request, body: Record<string, unknown>) {
  const userId = String(body.userId || "");
  const permission = String(body.permission || "");
  const effect = String(body.effect || "ALLOW").toUpperCase();
  const reason = String(body.reason || "").trim();
  const validUntil = body.validUntil ? String(body.validUntil) : null;
  if (!userId || !permission) return fail("userId and permission are required.");
  if (permission === "all") return fail("The all permission cannot be granted directly to a user.", 409);
  if (!["ALLOW", "DENY"].includes(effect)) return fail("Effect must be ALLOW or DENY.");
  if (!reason) return fail("A reason is required for an individual permission grant.");
  if (!validUntil) return fail("An expiry date is required for an individual permission grant.");
  try {
    await assertPermissionCode(admin, permission);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid permission.");
  }

  const { data, error } = await admin
    .from("user_permissions")
    .upsert({
      user_id: userId,
      permission,
      effect,
      reason,
      valid_from: new Date().toISOString(),
      valid_until: validUntil,
      granted_by: actor.userId,
    }, { onConflict: "user_id,permission" })
    .select()
    .single();
  if (error) return fail(error.message);

  await audit(admin, actor, req, {
    action: "USER_PERMISSION_GRANTED",
    entityType: "USER",
    entityId: userId,
    newValues: { permission, effect, valid_until: validUntil, reason },
  });
  return json({ userPermission: data });
}

async function revokeUserPermission(admin: SupabaseClient, actor: Actor, req: Request, body: Record<string, unknown>) {
  const id = String(body.id || "");
  if (!id) return fail("id is required.");
  const { data: before } = await admin.from("user_permissions").select("*").eq("id", id).maybeSingle();
  const { error } = await admin.from("user_permissions").delete().eq("id", id);
  if (error) return fail(error.message);
  await audit(admin, actor, req, {
    action: "USER_PERMISSION_REVOKED",
    entityType: "USER",
    entityId: before?.user_id || null,
    oldValues: before,
  });
  return json({ ok: true });
}

async function saveModule(admin: SupabaseClient, actor: Actor, req: Request, body: Record<string, unknown>) {
  const moduleInput = (body.module || {}) as Record<string, unknown>;
  const code = String(moduleInput.code || "").trim();
  if (!code) return fail("Module code is required.");
  const { data: before } = await admin.from("modules").select("*").eq("code", code).maybeSingle();
  const payload = {
    code,
    name: String(moduleInput.name || code).trim(),
    description: moduleInput.description ? String(moduleInput.description) : null,
    base_path: String(moduleInput.base_path || `/dashboard/${code}`),
    icon: moduleInput.icon ? String(moduleInput.icon) : null,
    sort_order: Number(moduleInput.sort_order ?? 100),
    is_active: moduleInput.is_active === undefined ? true : Boolean(moduleInput.is_active),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin.from("modules").upsert(payload, { onConflict: "code" }).select().single();
  if (error) return fail(error.message);
  await audit(admin, actor, req, {
    action: before ? "MODULE_UPDATED" : "MODULE_CREATED",
    entityType: "MODULE",
    entityId: data.id,
    entityReference: code,
    oldValues: before,
    newValues: data,
  });
  return json({ module: data });
}

async function deleteModule(admin: SupabaseClient, actor: Actor, req: Request, body: Record<string, unknown>) {
  const code = String(body.code || "");
  if (!code) return fail("Module code is required.");
  const { count } = await admin.from("menu_items").select("code", { count: "exact", head: true }).eq("module_code", code);
  if ((count || 0) > 0) return fail("This module still has menus attached. Remove or reassign them first.");
  const { data: before } = await admin.from("modules").select("*").eq("code", code).maybeSingle();
  const { error } = await admin.from("modules").delete().eq("code", code);
  if (error) return fail(error.message);
  await audit(admin, actor, req, { action: "MODULE_DELETED", entityType: "MODULE", entityReference: code, oldValues: before });
  return json({ ok: true });
}

async function saveMenu(admin: SupabaseClient, actor: Actor, req: Request, body: Record<string, unknown>) {
  const menu = (body.menu || {}) as Record<string, unknown>;
  const code = String(menu.code || "").trim();
  if (!code) return fail("Menu code is required.");
  if (!menu.module_code) return fail("Menu must belong to a module.");
  const { data: before } = await admin.from("menu_items").select("*").eq("code", code).maybeSingle();
  const payload = {
    code,
    module_code: String(menu.module_code),
    parent_code: menu.parent_code ? String(menu.parent_code) : null,
    label: String(menu.label || code),
    href: String(menu.href || "#"),
    icon: menu.icon ? String(menu.icon) : null,
    sort_order: Number(menu.sort_order ?? 100),
    required_permissions: Array.isArray(menu.required_permissions) ? menu.required_permissions : [],
    is_active: menu.is_active === undefined ? true : Boolean(menu.is_active),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin.from("menu_items").upsert(payload, { onConflict: "code" }).select().single();
  if (error) return fail(error.message);
  await audit(admin, actor, req, {
    action: before ? "MENU_UPDATED" : "MENU_CREATED",
    entityType: "MENU",
    entityId: data.id,
    entityReference: code,
    oldValues: before,
    newValues: data,
  });
  return json({ menu: data });
}

async function deleteMenu(admin: SupabaseClient, actor: Actor, req: Request, body: Record<string, unknown>) {
  const code = String(body.code || "");
  if (!code) return fail("Menu code is required.");
  const { data: before } = await admin.from("menu_items").select("*").eq("code", code).maybeSingle();
  const { error } = await admin.from("menu_items").delete().eq("code", code);
  if (error) return fail(error.message);
  await audit(admin, actor, req, { action: "MENU_DELETED", entityType: "MENU", entityReference: code, oldValues: before });
  return json({ ok: true });
}

async function saveRoleScope(admin: SupabaseClient, actor: Actor, req: Request, body: Record<string, unknown>) {
  const roleId = String(body.roleId || "");
  const scopeType = String(body.scopeType || "");
  if (!roleId || !scopeType) return fail("roleId and scopeType are required.");
  const role = await roleById(admin, roleId);
  if (!role) return fail("Role not found", 404);
  if (role.name === SYSTEM_ADMINISTRATOR && scopeType !== "SYSTEM_WIDE") {
    return fail("System Administrator must retain SYSTEM_WIDE data scope.", 409);
  }

  const { error: deleteError } = await admin.from("role_data_scopes").delete().eq("role_id", roleId);
  if (deleteError) return fail(deleteError.message);
  const { error } = await admin.from("role_data_scopes").insert({
    role_id: roleId,
    scope_type: scopeType,
    department_ids: Array.isArray(body.departmentIds) ? body.departmentIds : [],
  });
  if (error) return fail(error.message);
  const { error: roleError } = await admin.from("roles").update({ data_scope_type: scopeType }).eq("id", roleId);
  if (roleError) return fail(roleError.message);
  await audit(admin, actor, req, {
    action: "DATA_SCOPE_CHANGED",
    entityType: "ROLE",
    entityId: roleId,
    entityReference: role.name,
    oldValues: { scope_type: role.data_scope_type },
    newValues: { scope_type: scopeType },
  });
  return json({ ok: true });
}

async function saveUserScope(admin: SupabaseClient, actor: Actor, req: Request, body: Record<string, unknown>) {
  const userId = String(body.userId || "");
  const scopeType = String(body.scopeType || "");
  if (!userId || !scopeType) return fail("userId and scopeType are required.");
  const { error: deleteError } = await admin.from("user_data_scopes").delete().eq("user_id", userId);
  if (deleteError) return fail(deleteError.message);
  const { data, error } = await admin.from("user_data_scopes").insert({
    user_id: userId,
    scope_type: scopeType,
    department_ids: Array.isArray(body.departmentIds) ? body.departmentIds : [],
    valid_until: body.validUntil ? String(body.validUntil) : null,
    assigned_by: actor.userId,
  }).select().single();
  if (error) return fail(error.message);
  await audit(admin, actor, req, { action: "USER_DATA_SCOPE_CHANGED", entityType: "USER", entityId: userId, newValues: data });
  return json({ userScope: data });
}

async function revokeUserScope(admin: SupabaseClient, actor: Actor, req: Request, body: Record<string, unknown>) {
  const userId = String(body.userId || "");
  if (!userId) return fail("userId is required.");
  const { data: before } = await admin.from("user_data_scopes").select("*").eq("user_id", userId);
  const { error } = await admin.from("user_data_scopes").delete().eq("user_id", userId);
  if (error) return fail(error.message);
  await audit(admin, actor, req, { action: "USER_DATA_SCOPE_REVOKED", entityType: "USER", entityId: userId, oldValues: before });
  return json({ ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return fail("Method not allowed", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
  if (!supabaseUrl || !serviceRoleKey) return fail("Supabase server configuration is unavailable", 500);

  const authorization = req.headers.get("authorization")?.trim() || "";
  if (!/^Bearer\s+\S+/i.test(authorization)) return fail("Authentication required", 401);
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request body");
  }

  const action = String(body.action || "").toUpperCase();
  const required = ACTION_PERMISSIONS[action];
  if (!required) return fail("Unsupported access administration action");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const actor = await resolveActor(admin, token);
  if (!actor) return fail("Authentication required", 401);
  if (!can(actor, required)) {
    await audit(admin, actor, req, {
      action: "ACCESS_DENIED",
      entityType: "AUTHORIZATION",
      metadata: { attempted_action: action, required_permission: required },
    });
    return fail("Access denied", 403);
  }

  try {
    switch (action) {
      case "UPDATE_ROLE": return await updateRole(admin, actor, req, body);
      case "SET_ROLE_PERMISSIONS": return await setRolePermissions(admin, actor, req, body);
      case "TOGGLE_ROLE_PERMISSION": return await toggleRolePermission(admin, actor, req, body);
      case "GRANT_USER_PERMISSION": return await grantUserPermission(admin, actor, req, body);
      case "REVOKE_USER_PERMISSION": return await revokeUserPermission(admin, actor, req, body);
      case "SAVE_MODULE": return await saveModule(admin, actor, req, body);
      case "DELETE_MODULE": return await deleteModule(admin, actor, req, body);
      case "SAVE_MENU": return await saveMenu(admin, actor, req, body);
      case "DELETE_MENU": return await deleteMenu(admin, actor, req, body);
      case "SAVE_ROLE_SCOPE": return await saveRoleScope(admin, actor, req, body);
      case "SAVE_USER_SCOPE": return await saveUserScope(admin, actor, req, body);
      case "REVOKE_USER_SCOPE": return await revokeUserScope(admin, actor, req, body);
      default: return fail("Unsupported access administration action");
    }
  } catch (error) {
    console.error(`Access administration action ${action} failed`, error);
    return fail(error instanceof Error ? error.message : "Action failed", 500);
  }
});
