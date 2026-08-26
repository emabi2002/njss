import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const ASSIGNABLE_ROLES = new Set([
  "Requisition Officer",
  "Line Supervisor",
  "Registrar",
  "Payment/Reconciliation Officer",
  "System Administrator",
]);
const SECTION_ROLES = new Set(["Requisition Officer", "Line Supervisor"]);
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const USER_FIELDS =
  "id,email,full_name,employee_id,phone,position,department_id,section_id,is_active,is_protected,must_change_password,auth_user_id,password_set_at,password_changed_at,last_login_at,invited_at,archived_at,archive_reason,created_at";

type AppContext = {
  userId: string;
  authUserId: string;
  email: string;
  name: string;
};

type ActionBody = {
  action?: string;
  userId?: string;
  reason?: string;
  user?: {
    email?: string;
    full_name?: string;
    employee_id?: string | null;
    phone?: string | null;
    position?: string | null;
    department_id?: string | null;
    section_id?: string | null;
    role_id?: string | null;
    is_active?: boolean;
  };
  password?: string;
  confirmPassword?: string;
  generatePassword?: boolean;
  sendWelcomeEmail?: boolean;
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

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/pass|secret|token|credential|otp|pin/i.test(key)) continue;
      output[key] = redactSensitive(item);
    }
    return output;
  }
  return value;
}

function validatePassword(password: string, confirmation?: string) {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) errors.push(`Password must contain: at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (password.length > PASSWORD_MAX_LENGTH) errors.push(`Password must not exceed ${PASSWORD_MAX_LENGTH} characters.`);
  if (!/[A-Z]/.test(password)) errors.push("Password must contain: one upper-case letter.");
  if (!/[a-z]/.test(password)) errors.push("Password must contain: one lower-case letter.");
  if (!/[0-9]/.test(password)) errors.push("Password must contain: one number.");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("Password must contain: one special character.");
  if (confirmation !== undefined && password !== confirmation) errors.push("Password and confirmation do not match.");
  return errors;
}

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const SPECIAL = "!@#$%^&*()-_=+[]{}:,.?";
function pick(chars: string) {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return chars[bytes[0] % chars.length];
}
function generateTemporaryPassword(length = 16) {
  const target = Math.max(PASSWORD_MIN_LENGTH, Math.min(length, 32));
  const all = UPPER + LOWER + DIGIT + SPECIAL;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)];
  while (chars.length < target) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const bytes = new Uint8Array(1);
    crypto.getRandomValues(bytes);
    const j = bytes[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function authorize(req: Request, admin: SupabaseClient): Promise<AppContext | Response> {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail("Authentication required", 401);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return fail("Authentication required", 401);

  const authUser = authData.user;
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id,auth_user_id,email,full_name,is_active")
    .or(`auth_user_id.eq.${authUser.id},email.eq.${authUser.email || ""}`)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (profileError || !profile) return fail("NJSS profile not found", 403);

  const { data: roleRows, error: roleError } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", profile.id);
  if (roleError) return fail("Unable to resolve administrator permissions", 500);
  const roleIds = (roleRows || []).map((row) => row.role_id).filter(Boolean);
  if (!roleIds.length) return fail("Access denied", 403);

  const { data: permissionRows, error: permissionError } = await admin
    .from("role_permissions")
    .select("permission")
    .eq("is_allowed", true)
    .in("role_id", roleIds);
  if (permissionError) return fail("Unable to resolve administrator permissions", 500);
  const permissions = new Set((permissionRows || []).map((row) => row.permission));
  if (!permissions.has("all") && !permissions.has("users.manage")) return fail("Access denied", 403);

  return {
    userId: profile.id,
    authUserId: authUser.id,
    email: profile.email || authUser.email || "",
    name: profile.full_name || authUser.email?.split("@")[0] || "Administrator",
  };
}

async function audit(
  admin: SupabaseClient,
  context: AppContext,
  action: string,
  entityId: string | null,
  entityReference: string | null,
  input: { oldValues?: unknown; newValues?: unknown; changes?: unknown; metadata?: unknown } = {},
) {
  const { error } = await admin.from("audit_logs").insert({
    user_id: context.userId,
    user_email: context.email,
    user_name: context.name,
    action,
    entity_type: "USER",
    entity_id: entityId,
    entity_reference: entityReference,
    old_values: input.oldValues ? redactSensitive(input.oldValues) : null,
    new_values: input.newValues ? redactSensitive(input.newValues) : null,
    changes: input.changes ? redactSensitive(input.changes) : null,
    metadata: input.metadata ? redactSensitive(input.metadata) : null,
  });
  if (error) console.error("Audit write failed", error.message);
}

async function loadUser(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from("users")
    .select(`${USER_FIELDS}, user_roles(role:roles(id,name,is_business_role,is_protected,data_scope_type))`)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, any> | null;
}

async function roleById(admin: SupabaseClient, roleId: string) {
  const { data, error } = await admin
    .from("roles")
    .select("id,name,is_business_role,is_protected,is_active")
    .eq("id", roleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Selected role does not exist.");
  if (!data.is_active) throw new Error("Selected role is no longer active.");
  if (!ASSIGNABLE_ROLES.has(data.name)) throw new Error("Only the four operational groups or System Administrator can be assigned.");
  return data;
}

async function setSingleRole(admin: SupabaseClient, userId: string, roleId: string) {
  const { data: current } = await admin.from("user_roles").select("role_id").eq("user_id", userId);
  const oldRoleIds = (current || []).map((row) => row.role_id);
  const { error: deleteError } = await admin.from("user_roles").delete().eq("user_id", userId);
  if (deleteError) throw new Error(deleteError.message);
  const { error: insertError } = await admin.from("user_roles").insert({ user_id: userId, role_id: roleId });
  if (insertError) {
    if (oldRoleIds.length) await admin.from("user_roles").insert(oldRoleIds.map((oldRoleId) => ({ user_id: userId, role_id: oldRoleId })));
    throw new Error(insertError.message);
  }
}

async function activeAdminCount(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("njss_active_system_administrator_count");
  if (error) throw new Error(error.message);
  return Number(data || 0);
}

async function isSystemAdministrator(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("user_roles").select("role:roles(name)").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data || []).some((row: any) => row.role?.name === "System Administrator");
}

async function activitySummary(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.rpc("njss_user_activity_summary", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data as Record<string, number | boolean>;
}

async function banAuthUser(admin: SupabaseClient, authUserId: string | null, banned: boolean) {
  if (!authUserId) return;
  const { error } = await admin.auth.admin.updateUserById(authUserId, {
    ban_duration: banned ? "876000h" : "none",
  });
  if (error) console.error("Auth ban/unban failed", error.message);
}

async function createUser(admin: SupabaseClient, context: AppContext, body: ActionBody) {
  const input = body.user || {};
  const email = (input.email || "").trim().toLowerCase();
  const fullName = (input.full_name || "").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("A valid email address is required.");
  if (!fullName) return fail("Full name is required.");
  if (!input.role_id) return fail("Exactly one major access group must be selected.");

  const role = await roleById(admin, input.role_id);
  if (SECTION_ROLES.has(role.name) && !input.section_id) return fail(`${role.name} requires an assigned section.`);

  const password = body.generatePassword ? generateTemporaryPassword() : body.password || "";
  const passwordErrors = body.generatePassword ? [] : validatePassword(password, body.confirmPassword);
  if (passwordErrors.length) return json({ error: passwordErrors[0], errors: passwordErrors }, 400);

  const { data: existing } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (existing) return fail("A user with that email address already exists.");

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (authError || !created.user) return fail(authError?.message || "Unable to create the authentication account.");

  const now = new Date().toISOString();
  const { data: profile, error: profileError } = await admin
    .from("users")
    .insert({
      auth_user_id: created.user.id,
      email,
      full_name: fullName,
      employee_id: input.employee_id || null,
      phone: input.phone || null,
      position: input.position || null,
      department_id: input.department_id || null,
      section_id: input.section_id || null,
      is_active: input.is_active ?? true,
      must_change_password: true,
      password_set_at: now,
      invited_at: body.sendWelcomeEmail ? now : null,
    })
    .select(USER_FIELDS)
    .single();
  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    return fail(profileError?.message || "Unable to create the NJSS user profile.");
  }

  try {
    await setSingleRole(admin, profile.id, role.id);
  } catch (error) {
    await admin.from("users").delete().eq("id", profile.id);
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    throw error;
  }

  await audit(admin, context, "USER_CREATED", profile.id, email, {
    newValues: profile,
    changes: { role: role.name, department_id: input.department_id, section_id: input.section_id },
  });
  await audit(admin, context, "USER_PASSWORD_SET", profile.id, email, {
    metadata: { method: body.generatePassword ? "GENERATED_TEMPORARY" : "ADMINISTRATOR_SET", must_change_password: true },
  });

  return json({ user: profile, generatedPassword: body.generatePassword ? password : undefined });
}

async function updateUser(admin: SupabaseClient, context: AppContext, body: ActionBody) {
  if (!body.userId) return fail("userId is required.");
  const before = await loadUser(admin, body.userId);
  if (!before) return fail("User not found", 404);
  const input = body.user || {};

  let targetRole: any = null;
  if (input.role_id) targetRole = await roleById(admin, input.role_id);
  const effectiveSectionId = input.section_id !== undefined ? input.section_id : before.section_id;
  if (targetRole && SECTION_ROLES.has(targetRole.name) && !effectiveSectionId) return fail(`${targetRole.name} requires an assigned section.`);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.full_name !== undefined) patch.full_name = input.full_name.trim();
  if (input.employee_id !== undefined) patch.employee_id = input.employee_id || null;
  if (input.phone !== undefined) patch.phone = input.phone || null;
  if (input.position !== undefined) patch.position = input.position || null;
  if (input.department_id !== undefined) patch.department_id = input.department_id || null;
  if (input.section_id !== undefined) patch.section_id = input.section_id || null;

  const { data: updated, error } = await admin.from("users").update(patch).eq("id", body.userId).select(USER_FIELDS).single();
  if (error) return fail(error.message);

  let roleChanged: string | null = null;
  if (targetRole) {
    const currentRoleId = before.user_roles?.[0]?.role?.id;
    if (currentRoleId !== targetRole.id) {
      await setSingleRole(admin, body.userId, targetRole.id);
      roleChanged = targetRole.name;
    }
  }

  await audit(admin, context, "USER_UPDATED", body.userId, updated.email, {
    oldValues: before,
    newValues: updated,
    changes: roleChanged ? { role: roleChanged } : undefined,
  });
  return json({ user: updated });
}

async function setActive(admin: SupabaseClient, context: AppContext, body: ActionBody) {
  const userId = body.userId;
  const nextActive = body.user?.is_active;
  if (!userId || typeof nextActive !== "boolean") return fail("userId and is_active are required.");
  if (!nextActive && userId === context.userId) return fail("You cannot deactivate your own account.");
  const before = await loadUser(admin, userId);
  if (!before) return fail("User not found", 404);
  if (!nextActive && before.is_protected) return fail("This is a protected technical account and cannot be deactivated.");
  if (!nextActive && await isSystemAdministrator(admin, userId) && await activeAdminCount(admin) <= 1) return fail("The final active System Administrator cannot be deactivated.");

  const { data: updated, error } = await admin.from("users").update({ is_active: nextActive, updated_at: new Date().toISOString() }).eq("id", userId).select(USER_FIELDS).single();
  if (error) return fail(error.message);
  await banAuthUser(admin, before.auth_user_id, !nextActive);
  await audit(admin, context, nextActive ? "USER_RESTORED" : "USER_DEACTIVATED", userId, updated.email, { oldValues: { is_active: before.is_active }, newValues: { is_active: nextActive } });
  return json({ user: updated });
}

async function resetPassword(admin: SupabaseClient, context: AppContext, body: ActionBody) {
  if (!body.userId) return fail("userId is required.");
  const user = await loadUser(admin, body.userId);
  if (!user) return fail("User not found", 404);
  if (!user.auth_user_id) return fail("This profile has no linked authentication account.");
  const password = body.generatePassword ? generateTemporaryPassword() : body.password || "";
  const errors = body.generatePassword ? [] : validatePassword(password, body.confirmPassword);
  if (errors.length) return json({ error: errors[0], errors }, 400);
  const { error: authError } = await admin.auth.admin.updateUserById(user.auth_user_id, { password });
  if (authError) return fail(authError.message);
  const now = new Date().toISOString();
  await admin.from("users").update({ must_change_password: true, password_set_at: now, updated_at: now }).eq("id", body.userId);
  await audit(admin, context, "USER_PASSWORD_SET", body.userId, user.email || null, { metadata: { method: body.generatePassword ? "GENERATED_TEMPORARY" : "ADMINISTRATOR_RESET", must_change_password: true } });
  return json({ ok: true, generatedPassword: body.generatePassword ? password : undefined });
}

async function resendInvitation(admin: SupabaseClient, context: AppContext, body: ActionBody) {
  if (!body.userId) return fail("userId is required.");
  const user = await loadUser(admin, body.userId);
  if (!user) return fail("User not found", 404);
  const now = new Date().toISOString();
  await admin.from("users").update({ invited_at: now, updated_at: now }).eq("id", body.userId);
  await audit(admin, context, "USER_INVITATION_SENT", body.userId, user.email || null, { metadata: { includes_password: false, resend: true } });
  return json({ ok: true });
}

async function archiveUser(admin: SupabaseClient, context: AppContext, body: ActionBody) {
  const userId = body.userId;
  const reason = (body.reason || "").trim();
  if (!userId) return fail("userId is required.");
  if (!reason) return fail("An administrator reason is required to archive an account.");
  if (userId === context.userId) return fail("You cannot archive your own account.");
  const user = await loadUser(admin, userId);
  if (!user) return fail("User not found", 404);
  if (user.is_protected) return fail("This is a protected technical account and cannot be archived.");
  if (await isSystemAdministrator(admin, userId) && await activeAdminCount(admin) <= 1) return fail("The final active System Administrator cannot be archived.");
  const now = new Date().toISOString();
  const { data: updated, error } = await admin.from("users").update({ is_active: false, archived_at: now, archived_by: context.userId, archive_reason: reason, updated_at: now }).eq("id", userId).select(USER_FIELDS).single();
  if (error) return fail(error.message);
  await banAuthUser(admin, user.auth_user_id, true);
  await audit(admin, context, "USER_ARCHIVED", userId, updated.email, { oldValues: user, newValues: updated, metadata: { reason } });
  return json({ user: updated, outcome: "ARCHIVED" });
}

async function restoreUser(admin: SupabaseClient, context: AppContext, body: ActionBody) {
  if (!body.userId) return fail("userId is required.");
  const user = await loadUser(admin, body.userId);
  if (!user) return fail("User not found", 404);
  const { data: updated, error } = await admin.from("users").update({ is_active: true, archived_at: null, archived_by: null, archive_reason: null, updated_at: new Date().toISOString() }).eq("id", body.userId).select(USER_FIELDS).single();
  if (error) return fail(error.message);
  await banAuthUser(admin, user.auth_user_id, false);
  await audit(admin, context, "USER_RESTORED", body.userId, updated.email, { newValues: updated });
  return json({ user: updated });
}

async function deleteUser(admin: SupabaseClient, context: AppContext, body: ActionBody) {
  const userId = body.userId;
  const reason = (body.reason || "").trim();
  if (!userId) return fail("userId is required.");
  if (!reason) return fail("An administrator reason is required to delete an account.");
  if (userId === context.userId) return fail("You cannot delete your own account.");
  const user = await loadUser(admin, userId);
  if (!user) return fail("User not found", 404);
  if (user.is_protected) return fail("This is a protected technical account. Archive it instead.");
  if (await isSystemAdministrator(admin, userId) && await activeAdminCount(admin) <= 1) return fail("The final active System Administrator cannot be deleted.");

  const activity = await activitySummary(admin, userId);
  if (activity.can_hard_delete !== true) {
    return await archiveUser(admin, context, { userId, reason: `${reason} (converted to archive: historical records exist)` });
  }

  await admin.from("user_permissions").delete().eq("user_id", userId);
  await admin.from("user_data_scopes").delete().eq("user_id", userId);
  await admin.from("user_roles").delete().eq("user_id", userId);
  const { error: profileDeleteError } = await admin.from("users").delete().eq("id", userId);
  if (profileDeleteError) return fail(profileDeleteError.message);

  if (user.auth_user_id) {
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(user.auth_user_id);
    if (authDeleteError) console.error("Auth account deletion failed", authDeleteError.message);
  }
  await audit(admin, context, "USER_DELETED", userId, user.email || null, { oldValues: user, metadata: { reason, activity } });
  return json({ ok: true, outcome: "DELETED" });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return fail("Method not allowed", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return fail("Supabase server configuration is unavailable", 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authorized = await authorize(req, admin);
  if (authorized instanceof Response) return authorized;

  let body: ActionBody;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request body");
  }

  try {
    switch (String(body.action || "").toUpperCase()) {
      case "CREATE": return await createUser(admin, authorized, body);
      case "UPDATE": return await updateUser(admin, authorized, body);
      case "SET_ACTIVE": return await setActive(admin, authorized, body);
      case "RESET_PASSWORD": return await resetPassword(admin, authorized, body);
      case "RESEND_INVITATION": return await resendInvitation(admin, authorized, body);
      case "ARCHIVE": return await archiveUser(admin, authorized, body);
      case "RESTORE": return await restoreUser(admin, authorized, body);
      case "DELETE": return await deleteUser(admin, authorized, body);
      default: return fail("Unsupported user administration action");
    }
  } catch (error) {
    console.error("User administration edge action failed", error);
    return fail(error instanceof Error ? error.message : "Action failed", 400);
  }
});
