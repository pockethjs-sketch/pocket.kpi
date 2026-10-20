import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authorizeEmployee } from "../_shared/employee-access.mjs";
import {
  ACCOUNT_LIMITS, PASSWORD_FLAG, UUID, isAccountAdmin, passwordChangeRequired, isMasterUser, canManageTarget,
  validateCreate, validateUpdate, validateTempPassword, validateNewPassword,
  accountRow, sortAccounts, authErrorCode,
} from "../_shared/account-access.mjs";

// Employee account administration and first-login password change.
// - Every action requires a verified employee session + current ACTIVE organization membership.
// - OWNER/ADMIN create accounts with a temporary password, reset it, change role, pause/resume access.
// - Accounts with a temporary password must set their own password before using account actions.
// - Passwords travel only to Supabase Auth; they are never stored in tables, logged or returned.

const ALLOWED_ORIGINS = new Set([
  "https://pockethjs-sketch.github.io",
  "https://pocketkpi.netlify.app",
  "https://view.xn--9i1b674cwc38r6pa.com",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://pockethjs-sketch.github.io",
    "access-control-allow-headers": "authorization,apikey,content-type",
    "access-control-allow-methods": "POST,OPTIONS",
    vary: "origin",
  };
}

function reply(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function audit(supabase: any, organizationId: string, actor: string | null, target: string, action: string, before: unknown, after: unknown, metadata: Record<string, unknown> = {}) {
  await supabase.from("audit_events").insert({
    organization_id: organizationId, entity_type: "employee_account", entity_id: target, action_code: action,
    actor_user_id: actor, source: "USER", before_data: before ?? null, after_data: after ?? null, metadata,
  }).then(() => undefined, () => undefined);
}

// Creates a confirmed Auth user with a temporary password, its profile, ACTIVE membership and a claimed invitation.
async function createAccount(supabase: any, organizationId: string, input: any, actor: string | null, via: string) {
  const { data: created, error } = await supabase.auth.admin.createUser({
    email: input.email, password: input.password, email_confirm: true,
    app_metadata: { [PASSWORD_FLAG]: true },
  });
  if (error || !created?.user) {
    const code = authErrorCode(error);
    return { ok: false, status: code === "account_exists" ? 409 : code === "weak_password" ? 400 : 500, error: code === "auth_update_failed" ? "account_create_failed" : code };
  }
  const userId = created.user.id;
  const now = new Date().toISOString();
  const steps = [
    () => supabase.from("profiles").upsert({ id: userId, display_name: input.name, email: input.email, state: "ACTIVE", archived_at: null }),
    () => supabase.from("organization_memberships").upsert({ organization_id: organizationId, user_id: userId, role: input.role, state: "ACTIVE", archived_at: null }, { onConflict: "organization_id,user_id" }),
    () => supabase.from("employee_invitations").upsert({ organization_id: organizationId, email: input.email, role: input.role, approved_by: actor, claimed_user_id: userId, claimed_at: now }, { onConflict: "organization_id,email" }),
  ];
  for (const step of steps) {
    const { error: stepError } = await step();
    if (stepError) {
      await supabase.from("organization_memberships").delete().eq("organization_id", organizationId).eq("user_id", userId).then(() => undefined, () => undefined);
      await supabase.from("profiles").delete().eq("id", userId).then(() => undefined, () => undefined);
      await supabase.auth.admin.deleteUser(userId).then(() => undefined, () => undefined);
      return { ok: false, status: 500, error: "account_create_failed" };
    }
  }
  await audit(supabase, organizationId, actor, userId, "account.create", null, { role: input.role, active: true, temporaryPassword: true }, { via });
  return { ok: true, userId };
}

async function loadTarget(supabase: any, organizationId: string, userId: string) {
  if (!UUID.test(userId)) return null;
  const { data: membership } = await supabase.from("organization_memberships").select("user_id,role,state,archived_at,created_at")
    .eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
  if (!membership) return null;
  const [{ data: profile }, { data: auth }] = await Promise.all([
    supabase.from("profiles").select("id,display_name,email").eq("id", userId).maybeSingle(),
    supabase.auth.admin.getUserById(userId),
  ]);
  const user = auth?.user || null;
  return { userId, role: membership.role, master: isMasterUser(user), membership, profile, user };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "method_not_allowed" }, 405);
  const organizationId = Deno.env.get("KPI_ORGANIZATION_ID") || "";
  if (!organizationId) return reply(req, { error: "organization_not_configured" }, 503);
  if (Number(req.headers.get("content-length") || 0) > ACCOUNT_LIMITS.bodyBytes) return reply(req, { error: "payload_too_large" }, 413);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let body: any;
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > ACCOUNT_LIMITS.bodyBytes) return reply(req, { error: "payload_too_large" }, 413);
    body = JSON.parse(text);
  } catch { return reply(req, { error: "bad_json" }, 400); }
  const action = String(body?.action || "");

  let authUser: any = null;
  const access = await authorizeEmployee({ request: req, organizationId,
    verifyUser: async (jwt: string) => { const result = await supabase.auth.getUser(jwt); authUser = result.data?.user || null; return result; },
    findMembership: (org: string, userId: string) => supabase.from("organization_memberships")
      .select("organization_id,user_id,role,state,archived_at").eq("organization_id", org).eq("user_id", userId).maybeSingle(),
  });
  if (!access.ok) return reply(req, { error: access.error }, access.status);
  const me = access.userId;
  const mustChange = passwordChangeRequired(authUser);

  if (action === "status") {
    const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", me).maybeSingle();
    const master = isMasterUser(authUser);
    return reply(req, { ok: true, userId: me, role: access.role, master, email: master ? "MASTER" : String(authUser?.email || ""),
      name: master ? "MASTER" : String(profile?.display_name || ""), mustChangePassword: mustChange, canManageAccounts: isAccountAdmin(access) && !mustChange });
  }

  if (action === "change_password") {
    const checked = validateNewPassword(body.password);
    if (!checked.ok) return reply(req, { error: checked.error }, checked.status);
    const { error } = await supabase.auth.admin.updateUserById(me, { password: checked.value, app_metadata: { [PASSWORD_FLAG]: null } });
    if (error) {
      const code = authErrorCode(error);
      return reply(req, { error: code === "weak_password" ? "weak_password" : "password_change_failed" }, code === "weak_password" ? 400 : 500);
    }
    await audit(supabase, organizationId, me, me, "account.password_changed", { temporaryPassword: mustChange }, { temporaryPassword: false });
    return reply(req, { ok: true });
  }

  if (mustChange) return reply(req, { error: "password_change_required" }, 403);
  if (!isAccountAdmin(access)) return reply(req, { error: "admin_required" }, 403);

  if (action === "accounts") {
    const { data: memberships, error } = await supabase.from("organization_memberships").select("user_id,role,state,archived_at,created_at")
      .eq("organization_id", organizationId);
    if (error) return reply(req, { error: "accounts_read_failed" }, 500);
    const members = (memberships || []).filter((row: any) => row.role !== "SERVICE");
    const ids = members.map((row: any) => row.user_id);
    const { data: profiles, error: profileError } = ids.length ? await supabase.from("profiles").select("id,display_name,email").in("id", ids) : { data: [], error: null };
    if (profileError) return reply(req, { error: "accounts_read_failed" }, 500);
    const byId = new Map((profiles || []).map((row: any) => [row.id, row]));
    const users = await Promise.all(ids.map((id: string) => supabase.auth.admin.getUserById(id).then((result: any) => result.data?.user || null, () => null)));
    const accounts = sortAccounts(members.map((membership: any, index: number) => accountRow({ membership, profile: byId.get(membership.user_id), user: users[index], me })))
      .map((row: any) => ({ ...row, manageable: canManageTarget(access, row) }));
    const { data: invitations, error: invitationError } = await supabase.from("employee_invitations").select("email,role,created_at")
      .eq("organization_id", organizationId).is("claimed_user_id", null);
    if (invitationError) return reply(req, { error: "accounts_read_failed" }, 500);
    return reply(req, { ok: true, me, role: access.role, accounts,
      pending: (invitations || []).filter((row: any) => row.role !== "OWNER").map((row: any) => ({ email: row.email, role: row.role, createdAt: row.created_at })) });
  }

  if (action === "create_account") {
    const checked = validateCreate(access, body);
    if (!checked.ok) return reply(req, { error: checked.error }, checked.status);
    const result = await createAccount(supabase, organizationId, checked.value, me, "admin");
    return result.ok ? reply(req, { ok: true, userId: result.userId }) : reply(req, { error: result.error }, result.status);
  }

  if (action === "reset_password" || action === "update_account") {
    const target = await loadTarget(supabase, organizationId, String(body.userId || ""));
    if (!target) return reply(req, { error: "account_not_found" }, 404);
    if (action === "reset_password") {
      if (!canManageTarget(access, target)) return reply(req, { error: "account_protected" }, 403);
      const temp = validateTempPassword(body.password);
      if (!temp.ok) return reply(req, { error: temp.error }, temp.status);
      const { error } = await supabase.auth.admin.updateUserById(target.userId, { password: temp.value, app_metadata: { [PASSWORD_FLAG]: true } });
      if (error) return reply(req, { error: authErrorCode(error) === "weak_password" ? "weak_password" : "password_reset_failed" }, 400);
      await audit(supabase, organizationId, me, target.userId, "account.reset_password", null, { temporaryPassword: true });
      return reply(req, { ok: true });
    }
    const checked = validateUpdate(access, target, body);
    if (!checked.ok) return reply(req, { error: checked.error }, checked.status);
    const patch = checked.value;
    const before = { role: target.role, active: target.membership.state === "ACTIVE" && !target.membership.archived_at, name: target.profile?.display_name || "" };
    const membershipPatch: Record<string, unknown> = {};
    if (patch.role) membershipPatch.role = patch.role;
    if (patch.active !== undefined) Object.assign(membershipPatch, patch.active ? { state: "ACTIVE", archived_at: null } : { state: "ARCHIVED", archived_at: new Date().toISOString() });
    if (Object.keys(membershipPatch).length) {
      const { error } = await supabase.from("organization_memberships").update(membershipPatch).eq("organization_id", organizationId).eq("user_id", target.userId);
      if (error) return reply(req, { error: "account_update_failed" }, 500);
    }
    if (patch.active !== undefined) {
      const { error } = await supabase.auth.admin.updateUserById(target.userId, { ban_duration: patch.active ? "none" : "876000h" });
      if (error) return reply(req, { error: "account_update_failed" }, 500);
    }
    if (patch.name) {
      const { error } = await supabase.from("profiles").update({ display_name: patch.name }).eq("id", target.userId);
      if (error) return reply(req, { error: "account_update_failed" }, 500);
    }
    await audit(supabase, organizationId, me, target.userId, "account.update", before, { ...before, ...patch });
    return reply(req, { ok: true });
  }

  return reply(req, { error: "unknown_action" }, 400);
});
