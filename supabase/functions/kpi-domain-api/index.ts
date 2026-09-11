import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

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
    "access-control-allow-headers": "authorization,apikey,content-type,x-kpi-app-token",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    vary: "origin",
  };
}

function reply(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const number = (value: unknown) => Number(value || 0);
const monthKey = (date: string) => String(date || "").slice(0, 7);

function buildMarketing(rows: any[], syncRows: any[]) {
  const byProviderDate = new Map<string, any>();
  for (const row of rows || []) {
    const provider = row.provider === "GOOGLE_ADS" ? "GOOGLE" : row.provider;
    const key = `${provider}:${row.spend_date}`;
    const target = byProviderDate.get(key) || {
      date: row.spend_date, spend: 0, impressions: 0, clicks: 0, crm: 0,
      leadSpend: 0, trafficSpend: 0, pocketTrafficSpend: 0, builderTrafficSpend: 0, otherSpend: 0,
      trafficDetailReady: provider === "META",
    };
    const spend = number(row.spend_amount);
    target.spend += spend;
    target.impressions += number(row.impressions);
    target.clicks += number(row.clicks);
    target.crm += number(row.conversions);
    if (row.channel_code === "META_LEAD") target.leadSpend += spend;
    if (row.channel_code === "META_POCKET_TRAFFIC") target.pocketTrafficSpend += spend;
    if (row.channel_code === "META_BUILDER_TRAFFIC") target.builderTrafficSpend += spend;
    if (row.channel_code === "META_OTHER") target.otherSpend += spend;
    if (String(row.channel_code).includes("TRAFFIC")) target.trafficSpend += spend;
    byProviderDate.set(key, target);
  }
  const marketingDaily: Record<string, any[]> = { META: [], NAVER: [], GOOGLE: [] };
  for (const [key, row] of byProviderDate) marketingDaily[key.split(":")[0]].push(row);
  for (const rowsForProvider of Object.values(marketingDaily)) rowsForProvider.sort((a, b) => a.date.localeCompare(b.date));

  const marketingSpend: Record<string, Record<string, number>> = {};
  for (const [provider, dailyRows] of Object.entries(marketingDaily)) {
    for (const row of dailyRows) {
      const month = monthKey(row.date);
      marketingSpend[month] ||= { META: 0, NAVER: 0, GOOGLE: 0 };
      marketingSpend[month][provider] += number(row.spend);
    }
  }
  const metaCampaigns: Record<string, any> = {};
  for (const row of marketingDaily.META) {
    const month = monthKey(row.date);
    const target = metaCampaigns[month] || {
      lead: 0, traffic: 0, pocketTraffic: 0, builderTraffic: 0, other: 0,
      rows: 0, detailedRows: 0,
    };
    target.lead += number(row.leadSpend);
    target.traffic += number(row.trafficSpend);
    target.pocketTraffic += number(row.pocketTrafficSpend);
    target.builderTraffic += number(row.builderTrafficSpend);
    target.other += number(row.otherSpend);
    target.rows += 1;
    target.detailedRows += row.trafficDetailReady ? 1 : 0;
    metaCampaigns[month] = target;
  }
  const sources = Object.fromEntries((syncRows || []).map((row) => [row.provider === "GOOGLE_ADS" ? "GOOGLE" : row.provider, {
    status: row.status, lastAttemptAt: row.last_attempt_at, lastSuccessAt: row.last_success_at,
    latestDate: row.latest_source_date, rows: row.row_count, amount: number(row.amount_total),
    errorCode: row.error_code || "", message: row.error_detail || "",
  }]));
  const latestFromStatus = Object.values(sources).reduce((latest: string, row: any) => row.latestDate > latest ? row.latestDate : latest, "");
  const latestFromRows = [...byProviderDate.values()].reduce((latest: string, row: any) => row.date > latest ? row.date : latest, "");
  const latestDate = latestFromStatus > latestFromRows ? latestFromStatus : latestFromRows;
  return {
    marketingSpend,
    marketingDaily,
    marketingMeta: {
      schema: "supabase-marketing-v2", backendVersion: "2026-09-10-domain-v2", latestDate, sources,
      campaigns: { META: metaCampaigns },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const token = Deno.env.get("KPI_PUBLIC_APP_TOKEN") || "";
  if (!token || req.headers.get("x-kpi-app-token") !== token) return reply(req, { error: "unauthorized" }, 401);
  const organizationId = Deno.env.get("KPI_ORGANIZATION_ID") || "";
  if (!organizationId) return reply(req, { error: "organization_not_configured" }, 503);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const url = new URL(req.url);
  let body: any = {};
  if (req.method === "POST") try { body = await req.json(); } catch { return reply(req, { error: "bad_json" }, 400); }
  const action = String(body.action || url.searchParams.get("action") || "meta");

  if (action === "meta") {
    const [{ data: current, error: currentError }, { data: projection, error: projectionError }, { data: sync, error: syncError }] = await Promise.all([
      supabase.from("app_current_state").select("primary_revision,updated_at").eq("organization_id", organizationId).maybeSingle(),
      supabase.from("app_state_projections").select("primary_revision,status,entity_counts,financial_totals,projected_at").eq("organization_id", organizationId).maybeSingle(),
      supabase.from("provider_sync_state").select("provider,status,last_success_at,latest_source_date,error_code").eq("organization_id", organizationId),
    ]);
    if (currentError || projectionError || syncError) return reply(req, { error: "meta_read_failed" }, 500);
    return reply(req, { ok: true, storageVersion: 2, mutationVersion: 3, backendVersion: "2026-09-10-domain-v2",
      revision: current?.primary_revision || "", updatedAt: current?.updated_at, projection, providerSync: sync || [] });
  }

  if (action === "bootstrap") {
    const { data, error } = await supabase.from("app_documents").select("document_key,document_value,projected_revision")
      .eq("organization_id", organizationId);
    if (error) return reply(req, { error: "bootstrap_read_failed", code: error.code }, 500);
    const documents: Record<string, unknown> = {};
    for (const row of data || []) documents[row.document_key] = row.document_value;
    return reply(req, { ok: true, documents, revision: data?.[0]?.projected_revision || "" });
  }

  if (action === "crm") {
    const { data, error } = await supabase.from("leads").select("source_payload,projected_revision")
      .eq("organization_id", organizationId).is("archived_at", null).order("created_at", { ascending: true });
    if (error) return reply(req, { error: "crm_read_failed", code: error.code }, 500);
    return reply(req, { ok: true, leads: (data || []).map((row) => row.source_payload), revision: data?.[0]?.projected_revision || "" });
  }

  if (action === "marketing") {
    const [{ data: rows, error }, { data: syncRows, error: syncError }] = await Promise.all([
      supabase.from("marketing_daily_spend").select("spend_date,provider,channel_code,spend_amount,impressions,clicks,conversions,payload")
        .eq("organization_id", organizationId).is("archived_at", null).order("spend_date", { ascending: true }).limit(5000),
      supabase.from("provider_sync_state").select("provider,status,last_attempt_at,last_success_at,latest_source_date,row_count,amount_total,error_code,error_detail")
        .eq("organization_id", organizationId),
    ]);
    if (error || syncError) return reply(req, { error: "marketing_read_failed", code: error?.code || syncError?.code }, 500);
    return reply(req, { ok: true, ...buildMarketing(rows || [], syncRows || []) });
  }

  if (action === "crm_refresh") {
    if (req.method !== "POST") return reply(req, { error: "method_not_allowed" }, 405);
    const start = String(body.start || "");
    const end = String(body.end || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
      return reply(req, { error: "invalid_date_range" }, 400);
    }
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    if (!serviceRole || !supabaseUrl) return reply(req, { error: "crm_sync_not_configured" }, 503);
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/kpi-crm-sync`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${serviceRole}`, apikey: serviceRole },
        body: JSON.stringify({ start, end }),
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        return reply(req, { error: payload?.error || "crm_sync_failed", message: payload?.message || "" }, response.status || 502);
      }
      return reply(req, payload);
    } catch (error) {
      return reply(req, { error: "crm_sync_unreachable", message: String(error instanceof Error ? error.message : error) }, 502);
    }
  }

  if (action === "mutation") {
    if (req.method !== "POST") return reply(req, { error: "method_not_allowed" }, 405);
    const required = ["mutationId", "baseRevision", "nextRevision", "mutation"];
    if (required.some((key) => !body[key])) return reply(req, { error: "missing_mutation_fields" }, 400);
    const requestHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body.mutation)))))
      .map((value) => value.toString(16).padStart(2, "0")).join("");
    const { data, error } = await supabase.rpc("commit_primary_mutation", {
      p_organization_id: organizationId, p_mutation_id: String(body.mutationId),
      p_base_revision: String(body.baseRevision), p_next_revision: String(body.nextRevision),
      p_request_hash: requestHash, p_mutation: body.mutation,
    });
    if (error) return reply(req, { error: "mutation_commit_failed", code: error.code }, 500);
    if (!data?.ok) return reply(req, data, data?.error === "revision_conflict" ? 409 : 400);
    return reply(req, { ...data, storageVersion: 2, mutationVersion: 3, primary: "supabase", sheetsBackup: { pending: true } });
  }
  return reply(req, { error: "unknown_action" }, 400);
});
