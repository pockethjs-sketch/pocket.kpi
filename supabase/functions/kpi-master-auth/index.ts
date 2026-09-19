import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = new Set([
  "https://pockethjs-sketch.github.io",
  "https://pocketkpi.netlify.app",
  "https://view.xn--9i1b674cwc38r6pa.com",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
]);
const MASTER_AUTH_EMAIL = "master@auth.pocket-kpi.invalid";
const LEGACY_MASTER_SHA256 = "3261cfae3f0acce8b6b365523b22fc6d5dfcb1bb71dfbf3b02c9e9f6911532d6";

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://pockethjs-sketch.github.io",
    "access-control-allow-headers": "apikey,content-type",
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

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function sameSecret(left: string, right: string) {
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(req, { error: "bad_json" }, 400); }
  const action = String(body.action || "login");
  const password = String(body.password || "");
  if (password.length < 12 || password.length > 256) return reply(req, { error: "invalid_credentials" }, 401);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const organizationId = Deno.env.get("KPI_ORGANIZATION_ID") || "";
  if (!url || !serviceKey || !organizationId) return reply(req, { error: "master_auth_not_configured" }, 503);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (action === "bootstrap") {
    const expectedToken = Deno.env.get("KPI_MASTER_BOOTSTRAP_TOKEN") || "";
    if (!expectedToken || !(await sameSecret(String(body.bootstrapToken || ""), expectedToken))) {
      return reply(req, { error: "invalid_setup_link" }, 403);
    }
    if ((await sha256(password)) === LEGACY_MASTER_SHA256) {
      return reply(req, { error: "choose_new_password" }, 400);
    }
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: MASTER_AUTH_EMAIL,
      password,
      email_confirm: true,
      app_metadata: { kpi_master_alias: true },
    });
    if (createError || !created.user) {
      return reply(req, { error: /already|registered|exists/i.test(createError?.message || "") ? "master_already_configured" : "master_setup_failed" }, 409);
    }
    const userId = created.user.id;
    const { error: profileError } = await supabase.from("profiles").upsert({ id: userId, display_name: "MASTER", email: null, state: "ACTIVE", archived_at: null });
    const { error: membershipError } = profileError ? { error: profileError } : await supabase.from("organization_memberships").upsert({
      organization_id: organizationId, user_id: userId, role: "OWNER", state: "ACTIVE", archived_at: null,
    }, { onConflict: "organization_id,user_id" });
    if (profileError || membershipError) {
      await supabase.auth.admin.deleteUser(userId);
      return reply(req, { error: "master_setup_failed" }, 500);
    }
    await supabase.from("employee_invitations").delete().eq("organization_id", organizationId).eq("role", "OWNER").is("claimed_user_id", null);
  } else if (action !== "login") {
    return reply(req, { error: "action_not_allowed" }, 400);
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email: MASTER_AUTH_EMAIL, password });
  if (error || !data.session) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return reply(req, { error: "invalid_credentials" }, 401);
  }
  return reply(req, { ok: true, session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
});
