import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

type PasswordBody = {
  password?: string;
  confirmPassword?: string;
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return fail("Method not allowed", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return fail("Supabase server configuration is unavailable", 500);
  }

  const authorization = req.headers.get("authorization")?.trim() || "";
  if (!/^Bearer\s+\S+/i.test(authorization)) return fail("Authentication required", 401);
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  let body: PasswordBody;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request body");
  }

  const password = body.password || "";
  const errors = validatePassword(password, body.confirmPassword);
  if (errors.length) return json({ error: errors[0], errors }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return fail("Authentication required", 401);
  const authUser = authData.user;

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id,email,full_name,is_active,must_change_password")
    .eq("auth_user_id", authUser.id)
    .eq("is_active", true)
    .maybeSingle();

  if (profileError) return fail("Unable to load the NJSS user profile", 500);
  if (!profile) return fail("NJSS profile not found", 403);
  if (!profile.must_change_password) return fail("A forced password change is not currently required for this account.", 409);

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });

  const authResult = await authResponse.json().catch(() => ({})) as Record<string, unknown>;
  if (!authResponse.ok) {
    const message =
      (typeof authResult.msg === "string" && authResult.msg) ||
      (typeof authResult.error_description === "string" && authResult.error_description) ||
      (typeof authResult.error === "string" && authResult.error) ||
      "Unable to change the password.";
    return fail(message, authResponse.status >= 500 ? 502 : 400);
  }

  const now = new Date().toISOString();
  const { error: stateError } = await admin
    .from("users")
    .update({
      must_change_password: false,
      password_changed_at: now,
      updated_at: now,
    })
    .eq("id", profile.id);

  if (stateError) {
    console.error("Password changed but forced-change state could not be cleared", stateError.message);
    return fail(
      "Your password was changed, but NJSS could not complete first-login setup. Sign in with the new password and contact an administrator.",
      500,
    );
  }

  const { error: auditError } = await admin.from("audit_logs").insert({
    user_id: profile.id,
    user_email: profile.email || authUser.email || null,
    user_name: profile.full_name || authUser.email?.split("@")[0] || "User",
    action: "PASSWORD_CHANGED",
    entity_type: "USER",
    entity_id: profile.id,
    entity_reference: profile.email || authUser.email || null,
    metadata: {
      self_service: true,
      forced_change_cleared: true,
      authentication: "PASSWORD",
    },
  });

  if (auditError) console.error("Unable to record self-service password audit", auditError.message);

  return json({ ok: true });
});
