import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const encoder = new TextEncoder();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

function safeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function verifyInternalService(req: Request) {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supplied = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return safeEqual(supplied, expected);
}

async function verify(req: Request, raw: string) {
  const secret = Deno.env.get("KPI_SHADOW_HMAC_SECRET") || "";
  const timestamp = req.headers.get("x-kpi-timestamp") || "";
  const supplied = req.headers.get("x-kpi-signature") || "";
  if (!secret || !timestamp || !supplied) return false;
  const epoch = Number(timestamp);
  if (!Number.isFinite(epoch) || Math.abs(Date.now() - epoch) > 5 * 60_000) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp + "." + raw))));
  if (expected.length !== supplied.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0;
}

function rows(value: any) {
  return Array.isArray(value) ? value : (value?.query || value?.data || value?.results || value?.rows || []);
}
function recordId(row: any, type: "LEAD" | "MEETING", index: number) {
  const candidates = type === "LEAD"
    ? [row?.proj_no, row?.project_no, row?.id, row?.no]
    : [row?.ms_no, row?.schedule_no, row?.id, row?.proj_no && row?.start_dt ? `${row.proj_no}:${row.start_dt}` : null];
  return String(candidates.find((x) => x !== undefined && x !== null && String(x) !== "") ?? `${type}:${index}:${row?.reg_dt || row?.mr_date || "unknown"}`);
}
function sourceDate(row: any, type: "LEAD" | "MEETING") {
  const value = String(type === "MEETING"
    ? (row?.start_dt || row?.mr_date || row?.reg_dt || row?.created_at || "")
    : (row?.reg_dt || row?.created_at || "")).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
async function sha256(value: unknown) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(value)))));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const raw = await req.text();
  const internalService = verifyInternalService(req);
  if (!internalService && !(await verify(req, raw))) return json({ error: "unauthorized" }, 401);
  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }
  const start = String(body.start || "");
  const end = String(body.end || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return json({ error: "invalid_date_range" }, 400);
  }
  // crmToken fallback is accepted only on the legacy HMAC path and is never persisted or returned.
  const token = String(Deno.env.get("CRM_BEARER_TOKEN") || (!internalService ? body.crmToken : "") || "");
  const organizationId = Deno.env.get("KPI_ORGANIZATION_ID") || "";
  if (!token || !organizationId) return json({ error: "server_not_configured" }, 503);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: run, error: runError } = await supabase.from("crm_sync_runs").insert({
    organization_id: organizationId, requested_start: start, requested_end: end, status: "RUNNING",
  }).select("id").single();
  if (runError) return json({ error: "sync_run_create_failed" }, 500);
  const origin = "https://crm.xn--9i1b674cwc38r6pa.com";
  const headers = { authorization: `Bearer ${token}`, origin, referer: `${origin}/`, "x-requested-with": "XMLHttpRequest", accept: "application/json" };
  const leadUrl = `https://api.xn--9i1b674cwc38r6pa.com/crm/v3/projects/newarrivals/v2?keyword=&start_dt=${encodeURIComponent(start + "T00:00:00+09:00")}&end_dt=${encodeURIComponent(end + "T23:59:59+09:00")}&is_inquiry=true`;
  const meetingUrl = `https://api.xn--9i1b674cwc38r6pa.com/crm/v3/mr_schedules?offset=0&limit=1000&state=1&page=schedule&start_dt=${encodeURIComponent(start + "T00:00:00+09:00")}&end_dt=${encodeURIComponent(end + "T23:59:59+09:00")}`;
  try {
    const [leadResponse, meetingResponse] = await Promise.all([fetch(leadUrl, { headers }), fetch(meetingUrl, { headers })]);
    if (!leadResponse.ok || !meetingResponse.ok) throw new Error(`crm_http_${leadResponse.status}_${meetingResponse.status}`);
    const leadRows = rows(await leadResponse.json()).filter((row: any) => {
      const day = String(row?.reg_dt || "").slice(0, 10); return day && day >= start && day <= end;
    });
    const meetingRows = rows(await meetingResponse.json()).filter((row: any) => Number(row?.mr_type) === 1);
    const rawRows = [];
    for (const [type, values] of [["LEAD", leadRows], ["MEETING", meetingRows]] as const) {
      for (let i = 0; i < values.length; i++) rawRows.push({
        organization_id: organizationId, sync_run_id: run.id, record_type: type,
        external_id: recordId(values[i], type, i), source_date: sourceDate(values[i], type),
        source_hash: await sha256(values[i]), payload: values[i], last_seen_at: new Date().toISOString(),
      });
    }
    for (let offset = 0; offset < rawRows.length; offset += 200) {
      const { error } = await supabase.from("crm_raw_records").upsert(rawRows.slice(offset, offset + 200), {
        onConflict: "organization_id,record_type,external_id,source_hash", ignoreDuplicates: false,
      });
      if (error) throw new Error(`raw_upsert_${error.code}`);
    }
    await supabase.from("crm_sync_runs").update({ status: "COMPLETED", lead_count: leadRows.length, meeting_count: meetingRows.length, completed_at: new Date().toISOString() }).eq("id", run.id);
    return json({ ok: true, start, end, leads: leadRows, meetings: meetingRows, fetchedAt: new Date().toISOString(), syncRunId: run.id, readBackend: "supabase-edge" });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    await supabase.from("crm_sync_runs").update({ status: "FAILED", error_code: message.slice(0, 200), completed_at: new Date().toISOString() }).eq("id", run.id);
    return json({ error: "crm_sync_failed", message }, 502);
  }
});
