import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const n = (value: unknown) => Number(value || 0);

async function verifyHmac(req: Request, raw: string) {
  const secret = Deno.env.get("KPI_SHADOW_HMAC_SECRET") || "";
  const timestamp = req.headers.get("x-kpi-timestamp") || "";
  const supplied = req.headers.get("x-kpi-signature") || "";
  if (!secret || !timestamp || !supplied || Math.abs(Date.now() - Number(timestamp)) > 300_000) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${raw}`))));
  if (expected.length !== supplied.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0;
}

function dateKst(offsetDays = 0) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetDays * 86_400_000);
  return now.toISOString().slice(0, 10);
}

function dateRange(start: string, end: string) {
  const out: string[] = [];
  for (let at = new Date(`${start}T00:00:00Z`); at <= new Date(`${end}T00:00:00Z`); at = new Date(at.getTime() + 86_400_000)) out.push(at.toISOString().slice(0, 10));
  return out;
}

async function fetchJson(url: string, init: RequestInit, label: string) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { throw new Error(`${label}_invalid_json_${response.status}`); }
  if (!response.ok || body?.error) {
    const code = body?.error?.code || body?.errorCode || response.status;
    throw new Error(`${label}_http_${code}`);
  }
  return body;
}

function metaConversions(actions: any[]) {
  const map = new Map((Array.isArray(actions) ? actions : []).map((row) => [String(row.action_type || ""), n(row.value)]));
  for (const key of ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"]) if (map.has(key)) return map.get(key) || 0;
  return 0;
}

async function collectMeta(config: Record<string, string>, start: string, end: string) {
  const account = String(config.MK_META_AD_ACCOUNT_ID || "").replace(/^act_/, "");
  const version = config.MK_META_GRAPH_VERSION || "v25.0";
  const traffic = new RegExp(config.MK_META_TRAFFIC_PATTERN || "트래픽|traffic|소셜임팩트", "i");
  const builder = new RegExp(config.MK_META_BUILDER_PATTERN || "빌더진", "i");
  const fields = "date_start,campaign_id,campaign_name,spend,impressions,clicks,actions";
  let next = `https://graph.facebook.com/${version}/act_${encodeURIComponent(account)}/insights?fields=${encodeURIComponent(fields)}&level=campaign&time_increment=1&time_range=${encodeURIComponent(JSON.stringify({ since: start, until: end }))}&limit=500`;
  const insights: any[] = [];
  for (let page = 0; next && page < 50; page++) {
    const body = await fetchJson(next, { headers: { authorization: `Bearer ${config.MK_META_ACCESS_TOKEN}` } }, "meta");
    insights.push(...(Array.isArray(body.data) ? body.data : []));
    next = body?.paging?.next || "";
  }
  return insights.map((row) => {
    const name = String(row.campaign_name || "");
    const channel = builder.test(name) ? "META_BUILDER_TRAFFIC" : traffic.test(name) ? "META_POCKET_TRAFFIC" : "META_LEAD";
    return { spend_date: row.date_start, provider: "META", channel_code: channel,
      campaign_external_id: String(row.campaign_id || "") || null, campaign_name: name,
      spend_amount: n(row.spend), impressions: n(row.impressions), clicks: n(row.clicks), conversions: metaConversions(row.actions),
      source_row_key: `edge:meta:${row.date_start}:${row.campaign_id || name}`,
      payload: { collector: "supabase-edge", campaignClass: channel }, archived_at: null };
  });
}

async function hmacBase64(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return btoa(String.fromCharCode(...bytes));
}

async function naverRequest(config: Record<string, string>, uri: string, params?: URLSearchParams) {
  const timestamp = String(Date.now());
  const signature = await hmacBase64(config.MK_NAVER_SECRET_KEY, `${timestamp}.GET.${uri}`);
  return fetchJson(`https://api.searchad.naver.com${uri}${params ? `?${params}` : ""}`, { headers: {
    "X-Timestamp": timestamp, "X-API-KEY": config.MK_NAVER_API_KEY,
    "X-Customer": config.MK_NAVER_CUSTOMER_ID, "X-Signature": signature,
  } }, "naver");
}

async function collectNaver(config: Record<string, string>, start: string, end: string) {
  const campaigns = await naverRequest(config, "/ncc/campaigns");
  const ids = (Array.isArray(campaigns) ? campaigns : []).map((row) => String(row.nccCampaignId || "")).filter(Boolean);
  if (!ids.length) throw new Error("naver_no_campaigns");
  const output: any[] = [];
  for (const date of dateRange(start, end)) {
    const total = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
    for (let offset = 0; offset < ids.length; offset += 50) {
      const params = new URLSearchParams();
      for (const id of ids.slice(offset, offset + 50)) params.append("ids", id);
      params.set("fields", JSON.stringify(["impCnt", "clkCnt", "salesAmt", "ccnt"]));
      params.set("timeRange", JSON.stringify({ since: date, until: date }));
      const body = await naverRequest(config, "/stats", params);
      for (const row of Array.isArray(body) ? body : body?.data || []) {
        total.spend += n(row.salesAmt); total.impressions += n(row.impCnt);
        total.clicks += n(row.clkCnt); total.conversions += n(row.ccnt);
      }
    }
    output.push({ spend_date: date, provider: "NAVER", channel_code: "NAVER", campaign_external_id: null,
      campaign_name: null, spend_amount: total.spend, impressions: total.impressions, clicks: total.clicks,
      conversions: total.conversions, source_row_key: `edge:naver:${date}`,
      payload: { collector: "supabase-edge" }, archived_at: null });
  }
  return output;
}

async function collectGoogle(config: Record<string, string>, start: string, end: string) {
  const oauthBody = new URLSearchParams({ client_id: config.MK_GOOGLE_CLIENT_ID, client_secret: config.MK_GOOGLE_CLIENT_SECRET,
    refresh_token: config.MK_GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" });
  const oauth = await fetchJson("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: oauthBody }, "google_oauth");
  const customer = String(config.MK_GOOGLE_CUSTOMER_ID || "").replace(/-/g, "");
  const query = `SELECT segments.date, campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}'`;
  const headers: Record<string, string> = { authorization: `Bearer ${oauth.access_token}`, "developer-token": config.MK_GOOGLE_DEVELOPER_TOKEN, "content-type": "application/json" };
  const login = String(config.MK_GOOGLE_LOGIN_CUSTOMER_ID || "").replace(/-/g, "");
  if (login) headers["login-customer-id"] = login;
  const body = await fetchJson(`https://googleads.googleapis.com/${config.MK_GOOGLE_API_VERSION || "v25"}/customers/${customer}/googleAds:searchStream`, { method: "POST", headers, body: JSON.stringify({ query }) }, "google_ads");
  const daily = new Map<string, any>();
  for (const batch of Array.isArray(body) ? body : [body]) for (const row of batch?.results || []) {
    const date = String(row?.segments?.date || ""); const metrics = row?.metrics || {};
    const target = daily.get(date) || { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
    target.spend += n(metrics.costMicros) / 1_000_000; target.impressions += n(metrics.impressions);
    target.clicks += n(metrics.clicks); target.conversions += n(metrics.conversions); daily.set(date, target);
  }
  return dateRange(start, end).map((date) => {
    const row = daily.get(date) || { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
    return { spend_date: date, provider: "GOOGLE_ADS", channel_code: "GOOGLE", campaign_external_id: null,
      campaign_name: null, spend_amount: row.spend, impressions: row.impressions, clicks: row.clicks,
      conversions: row.conversions, source_row_key: `edge:google:${date}`,
      payload: { collector: "supabase-edge" }, archived_at: null };
  });
}

const required: Record<string, string[]> = {
  META: ["MK_META_ACCESS_TOKEN", "MK_META_AD_ACCOUNT_ID"],
  NAVER: ["MK_NAVER_API_KEY", "MK_NAVER_SECRET_KEY", "MK_NAVER_CUSTOMER_ID"],
  GOOGLE_ADS: ["MK_GOOGLE_CLIENT_ID", "MK_GOOGLE_CLIENT_SECRET", "MK_GOOGLE_REFRESH_TOKEN", "MK_GOOGLE_DEVELOPER_TOKEN", "MK_GOOGLE_CUSTOMER_ID"],
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const raw = await req.text();
  let body: any; try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "bad_json" }, 400); }
  const appAuthorized = req.headers.get("x-kpi-app-token") === (Deno.env.get("KPI_PUBLIC_APP_TOKEN") || "__missing__");
  const cronAuthorized = req.headers.get("x-kpi-cron-secret") === (Deno.env.get("KPI_MARKETING_CRON_SECRET") || "__missing__");
  const hmacAuthorized = await verifyHmac(req, raw);
  if (!appAuthorized && !cronAuthorized && !hmacAuthorized) return json({ error: "unauthorized" }, 401);
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const organizationId = Deno.env.get("KPI_ORGANIZATION_ID") || "";
  if (!organizationId) return json({ error: "organization_not_configured" }, 503);

  if (body.action === "configure") {
    if (!hmacAuthorized) return json({ error: "hmac_required" }, 401);
    const { data, error } = await client.rpc("kpi_store_marketing_config", { p_config: body.config || {} });
    return error ? json({ error: "config_store_failed", code: error.code }, 500) : json(data);
  }
  if (body.action !== "sync") return json({ error: "unknown_action" }, 400);

  const { data: config, error: configError } = await client.rpc("kpi_read_marketing_config");
  if (configError) return json({ error: "config_read_failed", code: configError.code }, 500);
  const end = String(body.end || dateKst(0));
  const days = Math.max(1, Math.min(31, n(body.days || config.MK_BACKFILL_DAYS || 8)));
  const start = String(body.start || dateKst(-(days - 1)));
  const collectors: Record<string, () => Promise<any[]>> = {
    META: () => collectMeta(config, start, end), NAVER: () => collectNaver(config, start, end), GOOGLE_ADS: () => collectGoogle(config, start, end),
  };
  const results: Record<string, any> = {};
  for (const [provider, collect] of Object.entries(collectors)) {
    const missing = required[provider].filter((key) => !String(config[key] || "").trim());
    const attemptedAt = new Date().toISOString();
    if (missing.length) {
      const { error: stateError } = await client.from("provider_sync_state").upsert({
        organization_id: organizationId,
        provider,
        status: "DISABLED",
        checkpoint: { start, end, collector: "supabase-edge", missingCredentialCount: missing.length },
        last_attempt_at: attemptedAt,
        error_code: "missing_credentials",
        error_detail: `${missing.length} required credential(s) are not configured`,
        updated_at: attemptedAt,
      }, { onConflict: "organization_id,provider" });
      results[provider] = stateError
        ? { ok: false, error: "sync_state_failed", code: stateError.code }
        : { ok: false, error: "not_configured", missing };
      continue;
    }
    try {
      const rows = await collect();
      await client.from("marketing_daily_spend").update({ archived_at: new Date().toISOString() })
        .eq("organization_id", organizationId).eq("provider", provider).gte("spend_date", start).lte("spend_date", end)
        .eq("payload->>collector", "supabase-edge");
      const prepared = rows.map((row) => ({ ...row, organization_id: organizationId, projected_revision: null, updated_at: new Date().toISOString() }));
      const { error } = await client.from("marketing_daily_spend").upsert(prepared, { onConflict: "organization_id,provider,spend_date,campaign_external_id,source_row_key" });
      if (error) throw new Error(`upsert_${error.code}`);
      const amount = rows.reduce((sum, row) => sum + n(row.spend_amount), 0);
      const { error: stateError } = await client.from("provider_sync_state").upsert({ organization_id: organizationId, provider,
        status: "SUCCESS", checkpoint: { start, end, collector: "supabase-edge" }, last_attempt_at: attemptedAt,
        last_success_at: new Date().toISOString(), latest_source_date: end, row_count: rows.length,
        amount_total: amount, error_code: null, error_detail: null, updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,provider" });
      if (stateError) throw new Error(`sync_state_${stateError.code}`);
      results[provider] = { ok: true, rows: rows.length, amount, latestDate: end };
    } catch (error) {
      const detail = String(error instanceof Error ? error.message : error).slice(0, 500);
      await client.from("provider_sync_state").upsert({ organization_id: organizationId, provider, status: "FAILED",
        checkpoint: { start, end, collector: "supabase-edge" }, last_attempt_at: attemptedAt,
        error_code: detail.split("_").slice(0, 4).join("_"), error_detail: detail, updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,provider" });
      results[provider] = { ok: false, error: detail };
    }
  }
  const { data: finalized } = await client.rpc("kpi_finalize_marketing_sync", { p_organization_id: organizationId });
  const ok = Object.values(results).some((result: any) => result.ok);
  return json({ ok, start, end, results, finalized, backendVersion: "2026-09-10-marketing-edge-v2" }, ok ? 200 : 502);
});
