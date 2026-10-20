import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { premeetingWindow, premeetingQuery, normalizePremeetings } from "../_shared/premeeting-upcoming.mjs";

// Daily refresh (pg_cron 08:00 KST) of upcoming CRM premeetings for the buildup workspace overview.
// - Internal schedule only: gateway JWT (verify_jwt) plus the internal cron secret header shared with the
//   existing scheduled KPI job. No employee or browser path.
// - Reads the CRM premeeting calendar for today..+30 days with the server-held CRM token and replaces that
//   window in buildup_premeetings. KPI leads, raw CRM evidence and the KPI premeeting projection are untouched.
// - Responses and the run log carry window, counts and short error codes only (no customer data).

const CRM_ORIGIN = "https://crm.xn--9i1b674cwc38r6pa.com";
const CRM_SCHEDULES = "https://api.xn--9i1b674cwc38r6pa.com/crm/v3/mr_schedules?";
const CRM_PAGE_LIMIT = 1000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

function safeEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function rows(value: any) {
  const result = Array.isArray(value) ? value : (value?.query ?? value?.data ?? value?.results ?? value?.rows);
  if (!Array.isArray(result)) throw new Error("crm_response_invalid");
  return result;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const cronSecret = Deno.env.get("KPI_MARKETING_CRON_SECRET") || "";
  if (!safeEqual(req.headers.get("x-kpi-cron-secret") || "", cronSecret)) return json({ error: "unauthorized" }, 401);
  let body: any = {};
  try { const text = await req.text(); body = text ? JSON.parse(text) : {}; } catch { return json({ error: "bad_json" }, 400); }
  const trigger = body?.trigger === "manual" ? "manual" : "cron";
  const organizationId = Deno.env.get("KPI_ORGANIZATION_ID") || "";
  if (!organizationId) return json({ error: "organization_not_configured" }, 503);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const window = premeetingWindow(new Date());
  const { data: run, error: runError } = await supabase.from("buildup_premeeting_runs").insert({
    organization_id: organizationId, trigger, window_start: window.start, window_end: window.end, status: "RUNNING",
  }).select("id").single();
  if (runError || !run) return json({ error: "run_create_failed" }, 500);
  const finish = (patch: Record<string, unknown>) => supabase.from("buildup_premeeting_runs")
    .update({ ...patch, completed_at: new Date().toISOString() }).eq("id", run.id);
  const fail = async (code: string, status: number) => {
    await finish({ status: "FAILED", error_code: code }).then(() => undefined, () => undefined);
    return json({ error: "premeeting_sync_failed", code, start: window.start, end: window.end }, status);
  };

  const token = Deno.env.get("CRM_BEARER_TOKEN") || "";
  if (!token) return await fail("crm_not_configured", 503);
  let list: any[];
  try {
    const response = await fetch(CRM_SCHEDULES + premeetingQuery(window), {
      headers: { authorization: `Bearer ${token}`, origin: CRM_ORIGIN, referer: `${CRM_ORIGIN}/`, "x-requested-with": "XMLHttpRequest", accept: "application/json" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return await fail(`crm_http_${response.status}`, 502);
    list = rows(await response.json());
  } catch (error) {
    return await fail(error instanceof Error && error.message === "crm_response_invalid" ? "crm_response_invalid" : "crm_unreachable", 502);
  }
  // A full page may hide later schedules; never mark those as removed from a truncated read.
  if (list.length >= CRM_PAGE_LIMIT) return await fail("crm_page_limit", 502);
  let normalized: { rows: any[]; skipped: number };
  try { normalized = normalizePremeetings(list, window); }
  catch (error) { return await fail(error instanceof Error && error.message === "premeeting_too_many" ? "premeeting_too_many" : "crm_response_invalid", 502); }

  const { data: stored, error: storeError } = await supabase.rpc("buildup_store_premeetings", {
    p_organization_id: organizationId, p_start: window.start, p_end: window.end, p_rows: normalized.rows,
  });
  if (storeError || !stored?.ok) return await fail("premeeting_store_failed", 500);
  // Retention: schedules more than 30 days in the past are not needed for "today onward".
  const cutoff = new Date(Date.parse(window.start + "T00:00:00Z") - 30 * 86_400_000).toISOString().slice(0, 10);
  const { count: purged, error: purgeError } = await supabase.from("buildup_premeetings").delete({ count: "exact" })
    .eq("organization_id", organizationId).lt("meeting_day", cutoff);
  const { error: completeError } = await finish({
    status: "COMPLETED", fetched: normalized.rows.length, stored: stored.active, removed: stored.removed, skipped: normalized.skipped,
  });
  if (completeError) return json({ error: "run_complete_failed" }, 500);
  return json({ ok: true, trigger, start: window.start, end: window.end, fetched: normalized.rows.length,
    stored: stored.active, removed: stored.removed, purged: purgeError ? null : purged ?? 0, skipped: normalized.skipped });
});
