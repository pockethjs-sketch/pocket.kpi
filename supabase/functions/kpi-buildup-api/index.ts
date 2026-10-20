import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authorizeEmployee } from "../_shared/employee-access.mjs";
import {
  BUILDUP_ID, UUID, BUILDUP_LIMITS, byteLength, canUseBuildup, isBuildupAdmin, canReadBuildupOwner,
  validateSave, decideSave, validateAi, aiRateLimited, aiUpstreamError, createUsageTap, memberName, listItem, usageRows,
} from "../_shared/buildup-access.mjs";

// Sales buildup consultation workspace API.
// - Every request: verified Supabase Auth employee session + current ACTIVE organization membership.
// - Consultations are stored per employee; OWNER/ADMIN can read all, nobody edits others' records.
// - AI calls use the company Anthropic key from Supabase Secrets (ANTHROPIC_API_KEY); it is never returned.

const ALLOWED_ORIGINS = new Set([
  "https://pockethjs-sketch.github.io",
  "https://pocketkpi.netlify.app",
  "https://view.xn--9i1b674cwc38r6pa.com",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
]);
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

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

async function memberNames(supabase: any, organizationId: string) {
  const { data: memberships, error } = await supabase.from("organization_memberships")
    .select("user_id,role,state,archived_at").eq("organization_id", organizationId);
  if (error) return { error };
  const active = (memberships || []).filter((row: any) => row.state === "ACTIVE" && !row.archived_at && ["OWNER", "ADMIN", "EDITOR", "VIEWER"].includes(row.role));
  const ids = active.map((row: any) => row.user_id);
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles, error: profileError } = await supabase.from("profiles").select("id,display_name").in("id", ids);
    if (profileError) return { error: profileError };
    for (const profile of profiles || []) names.set(profile.id, memberName(profile));
  }
  return { names, members: active.map((row: any) => ({ userId: row.user_id, role: row.role, name: names.get(row.user_id) || "직원" })) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "method_not_allowed" }, 405);
  const organizationId = Deno.env.get("KPI_ORGANIZATION_ID") || "";
  if (!organizationId) return reply(req, { error: "organization_not_configured" }, 503);
  if (Number(req.headers.get("content-length") || 0) > BUILDUP_LIMITS.bodyBytes) return reply(req, { error: "payload_too_large" }, 413);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const access = await authorizeEmployee({ request: req, organizationId,
    verifyUser: (jwt: string) => supabase.auth.getUser(jwt),
    findMembership: (org: string, userId: string) => supabase.from("organization_memberships")
      .select("organization_id,user_id,role,state,archived_at").eq("organization_id", org).eq("user_id", userId).maybeSingle(),
  });
  if (!access.ok) return reply(req, { error: access.error }, access.status);
  if (!canUseBuildup(access)) return reply(req, { error: "permission_denied" }, 403);

  let body: any;
  try {
    const text = await req.text();
    if (byteLength(text) > BUILDUP_LIMITS.bodyBytes) return reply(req, { error: "payload_too_large" }, 413);
    body = JSON.parse(text);
  } catch { return reply(req, { error: "bad_json" }, 400); }
  const action = String(body?.action || "");
  const me = access.userId;

  if (action === "session") {
    const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", me).maybeSingle();
    return reply(req, { ok: true, userId: me, role: access.role, isAdmin: isBuildupAdmin(access), name: memberName(profile),
      aiReady: !!Deno.env.get("ANTHROPIC_API_KEY"), limits: { aiCallsPerHour: BUILDUP_LIMITS.aiCallsPerHour } });
  }

  if (action === "list") {
    const all = body.scope === "all";
    if (all && !isBuildupAdmin(access)) return reply(req, { error: "admin_required" }, 403);
    let query = supabase.from("buildup_projects").select("project_id,owner_user_id,revision,updated_at,summary")
      .eq("organization_id", organizationId).is("deleted_at", null);
    if (!all) query = query.eq("owner_user_id", me);
    const { data, error } = await query.order("updated_at", { ascending: false }).limit(BUILDUP_LIMITS.listRows);
    if (error) return reply(req, { error: "buildup_list_failed" }, 500);
    if (!all) return reply(req, { ok: true, items: (data || []).map((row: any) => listItem(row, null)) });
    const people = await memberNames(supabase, organizationId);
    if (people.error) return reply(req, { error: "members_read_failed" }, 500);
    return reply(req, { ok: true, items: (data || []).map((row: any) => listItem(row, people.names)), members: people.members });
  }

  if (action === "get") {
    const id = String(body.id || "");
    const ownerId = body.ownerId ? String(body.ownerId) : me;
    if (!BUILDUP_ID.test(id) || !UUID.test(ownerId)) return reply(req, { error: "invalid_project" }, 400);
    if (!canReadBuildupOwner(access, ownerId)) return reply(req, { error: "permission_denied" }, 403);
    const { data, error } = await supabase.from("buildup_projects").select("project_id,owner_user_id,revision,updated_at,core,heavy")
      .eq("organization_id", organizationId).eq("owner_user_id", ownerId).eq("project_id", id).is("deleted_at", null).maybeSingle();
    if (error) return reply(req, { error: "buildup_read_failed" }, 500);
    if (!data) return reply(req, { error: "not_found" }, 404);
    return reply(req, { ok: true, readOnly: ownerId !== me,
      item: { id: data.project_id, ownerId: data.owner_user_id, revision: data.revision, updatedAt: data.updated_at, core: data.core, heavy: data.heavy } });
  }

  if (action === "save") {
    const checked = validateSave(body);
    if (!checked.ok) return reply(req, { error: checked.error }, checked.status);
    const value = checked.value;
    const { data: existing, error } = await supabase.from("buildup_projects").select("revision,deleted_at")
      .eq("organization_id", organizationId).eq("owner_user_id", me).eq("project_id", value.id).maybeSingle();
    if (error) return reply(req, { error: "buildup_read_failed" }, 500);
    const plan: any = decideSave(existing, value);
    if (plan.error) return reply(req, { error: plan.error, revision: plan.revision }, plan.status);
    const now = new Date().toISOString();
    if (plan.action === "insert") {
      const { error: insertError } = await supabase.from("buildup_projects").insert({
        organization_id: organizationId, owner_user_id: me, project_id: value.id, summary: value.summary, core: value.core,
        heavy: value.heavy, revision: plan.nextRevision, created_at: now, updated_at: now,
      });
      if (insertError) return insertError.code === "23505" ? reply(req, { error: "conflict", revision: 0 }, 409) : reply(req, { error: "buildup_save_failed" }, 500);
      return reply(req, { ok: true, revision: plan.nextRevision, updatedAt: now });
    }
    const patch: Record<string, unknown> = { summary: value.summary, core: value.core, revision: plan.nextRevision, updated_at: now, deleted_at: null };
    if (value.heavy !== null) patch.heavy = value.heavy;
    const { data: updated, error: updateError } = await supabase.from("buildup_projects").update(patch)
      .eq("organization_id", organizationId).eq("owner_user_id", me).eq("project_id", value.id).eq("revision", existing.revision).select("revision");
    if (updateError) return reply(req, { error: "buildup_save_failed" }, 500);
    if (!updated?.length) return reply(req, { error: "conflict" }, 409);
    return reply(req, { ok: true, revision: plan.nextRevision, updatedAt: now });
  }

  if (action === "delete") {
    const id = String(body.id || "");
    if (!BUILDUP_ID.test(id)) return reply(req, { error: "invalid_project" }, 400);
    const { data: existing, error } = await supabase.from("buildup_projects").select("revision")
      .eq("organization_id", organizationId).eq("owner_user_id", me).eq("project_id", id).is("deleted_at", null).maybeSingle();
    if (error) return reply(req, { error: "buildup_read_failed" }, 500);
    if (!existing) return reply(req, { error: "not_found" }, 404);
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase.from("buildup_projects")
      .update({ deleted_at: now, updated_at: now, revision: existing.revision + 1 })
      .eq("organization_id", organizationId).eq("owner_user_id", me).eq("project_id", id).eq("revision", existing.revision).select("revision");
    if (updateError) return reply(req, { error: "buildup_delete_failed" }, 500);
    if (!updated?.length) return reply(req, { error: "conflict" }, 409);
    return reply(req, { ok: true });
  }

  if (action === "usage") {
    if (!isBuildupAdmin(access)) return reply(req, { error: "admin_required" }, 403);
    const days = Math.min(BUILDUP_LIMITS.usageDays, Math.max(1, Math.round(Number(body.days) || 30)));
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data, error } = await supabase.from("buildup_ai_usage").select("user_id,input_tokens,output_tokens,created_at")
      .eq("organization_id", organizationId).gte("created_at", since).order("created_at", { ascending: false }).limit(20_000);
    if (error) return reply(req, { error: "usage_read_failed" }, 500);
    return reply(req, { ok: true, days, rows: usageRows(data) });
  }

  if (action === "ai") {
    const key = Deno.env.get("ANTHROPIC_API_KEY") || "";
    if (!key) return reply(req, { error: "ai_not_configured" }, 503);
    const checked = validateAi(body);
    if (!checked.ok) return reply(req, { error: checked.error }, checked.status);
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count, error: countError } = await supabase.from("buildup_ai_usage").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("user_id", me).gte("created_at", since);
    if (countError) return reply(req, { error: "ai_usage_unavailable" }, 503);
    if (aiRateLimited(count)) return reply(req, { error: "ai_rate_limited" }, 429);
    const { data: ledger, error: ledgerError } = await supabase.from("buildup_ai_usage")
      .insert({ organization_id: organizationId, user_id: me, model: checked.value.model }).select("id").single();
    if (ledgerError) return reply(req, { error: "ai_usage_unavailable" }, 503);
    const settle = (status: string, usage: any = {}) => supabase.from("buildup_ai_usage").update({
      status, completed_at: new Date().toISOString(),
      input_tokens: Number.isInteger(usage.inputTokens) ? usage.inputTokens : null,
      output_tokens: Number.isInteger(usage.outputTokens) ? usage.outputTokens : null,
    }).eq("id", ledger.id).then(() => undefined, () => undefined);
    let upstream: Response;
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: "POST", signal: req.signal,
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(checked.value),
      });
    } catch {
      await settle("failed");
      return reply(req, { error: "upstream_unavailable" }, 502);
    }
    if (!upstream.ok) {
      let message = "";
      try { message = String((await upstream.json())?.error?.message || "").slice(0, 200); } catch { /* no body */ }
      await settle("failed");
      const mapped = aiUpstreamError(upstream.status);
      return reply(req, { error: mapped.error, message }, mapped.status);
    }
    if (!checked.value.stream) {
      const result = await upstream.json();
      const text = (result.content || []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("");
      await settle("completed", { inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens });
      return reply(req, { ok: true, text, model: result.model || checked.value.model, truncated: result.stop_reason === "max_tokens" });
    }
    const tap = createUsageTap();
    const decoder = new TextDecoder();
    const passThrough = new TransformStream({
      transform(chunk, controller) { tap.push(decoder.decode(chunk, { stream: true })); controller.enqueue(chunk); },
      async flush() { await settle("completed", tap.finish()); },
    });
    return new Response(upstream.body!.pipeThrough(passThrough), {
      status: 200,
      headers: { ...cors(req), "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return reply(req, { error: "unknown_action" }, 400);
});
