import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { authorizeEmployee } from "../_shared/employee-access.mjs";
import {
  BUILDUP_ID, UUID, BUILDUP_LIMITS, byteLength, canUseBuildup, isBuildupAdmin, canReadBuildupOwner,
  validateSave, decideSave, validateAi, aiRateLimited, aiUpstreamError, createUsageTap, memberName, listItem, usageRows,
} from "../_shared/buildup-access.mjs";
import { passwordChangeRequired } from "../_shared/account-access.mjs";
import { kstDay, premeetingItem, premeetingSync } from "../_shared/premeeting-upcoming.mjs";
import { crmLeadView } from "../_shared/crm-lead-tm.mjs";
import {
  AUDIO_BUCKET, AUDIO_KEY, AUDIO_LIMITS, RECORDING_ID, audioPath, validateAudioUpload, validateTranscribe, clovaRequest, clovaStartError,
  recordingItem, transcribeRateLimited, processingIsStale, newCallbackSecret, secretHash,
} from "../_shared/buildup-audio.mjs";

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
  let authUser: any = null;
  const access = await authorizeEmployee({ request: req, organizationId,
    verifyUser: async (jwt: string) => { const result = await supabase.auth.getUser(jwt); authUser = result.data?.user || null; return result; },
    findMembership: (org: string, userId: string) => supabase.from("organization_memberships")
      .select("organization_id,user_id,role,state,archived_at").eq("organization_id", org).eq("user_id", userId).maybeSingle(),
  });
  if (!access.ok) return reply(req, { error: access.error }, access.status);
  if (!canUseBuildup(access)) return reply(req, { error: "permission_denied" }, 403);
  // Accounts still on an administrator-set temporary password must choose their own first.
  if (passwordChangeRequired(authUser)) return reply(req, { error: "password_change_required" }, 403);

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
    let query = supabase.from("buildup_projects").select("project_id,owner_user_id,revision,updated_at,created_at,summary")
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

  // Upcoming CRM premeetings (today onward, KST) refreshed daily by kpi-buildup-premeetings. Read-only for every
  // buildup employee; the same companies are visible to them in the KPI premeeting list. Projects already prepared
  // from a schedule are marked so nobody prepares it twice (owner names only for OWNER/ADMIN).
  if (action === "premeetings") {
    const today = kstDay(new Date());
    const [{ data: rows, error }, { data: runs, error: runError }] = await Promise.all([
      supabase.from("buildup_premeetings")
        .select("schedule_no,meeting_at,meeting_end_at,meeting_day,meeting_way,company,contact,sales_owner,managers,booked_by,crm_project_no,visited,client,note")
        .eq("organization_id", organizationId).is("removed_at", null).gte("meeting_day", today)
        .order("meeting_at", { ascending: true }).limit(BUILDUP_LIMITS.premeetingRows),
      supabase.from("buildup_premeeting_runs").select("status,window_start,window_end,completed_at,error_code")
        .eq("organization_id", organizationId).order("started_at", { ascending: false }).limit(10),
    ]);
    if (error || runError) return reply(req, { error: "premeetings_read_failed" }, 500);
    const numbers = (rows || []).map((row: any) => row.schedule_no);
    const links = new Map<string, any>();
    if (numbers.length) {
      const { data: projects, error: linkError } = await supabase.from("buildup_projects")
        .select("project_id,owner_user_id,ms:summary->crm->>ms")
        .eq("organization_id", organizationId).is("deleted_at", null).in("summary->crm->>ms", numbers);
      if (linkError) return reply(req, { error: "premeetings_read_failed" }, 500);
      for (const project of projects || []) {
        const current = links.get(project.ms);
        if (!current || (project.owner_user_id === me && current.owner_user_id !== me)) links.set(project.ms, project);
      }
    }
    const admin = isBuildupAdmin(access);
    const people = admin && [...links.values()].some((project) => project.owner_user_id !== me) ? await memberNames(supabase, organizationId) : null;
    if (people?.error) return reply(req, { error: "members_read_failed" }, 500);
    const items = (rows || []).map((row: any) => {
      const project = links.get(row.schedule_no);
      if (!project) return premeetingItem(row);
      const mine = project.owner_user_id === me;
      return premeetingItem(row, mine ? { mine: true, projectId: project.project_id }
        : { mine: false, ...(admin ? { ownerId: project.owner_user_id, projectId: project.project_id, ownerName: people?.names?.get(project.owner_user_id) || "직원" } : {}) });
    });
    return reply(req, { ok: true, today, items, sync: premeetingSync(runs) });
  }

  // TM memo, first inquiry and TM diagnosis that the TM team keeps on the KPI lead of a CRM premeeting company.
  // Resolved from the stored premeeting schedule (client number, then project number); returns only those fields.
  if (action === "crmLead") {
    const scheduleNo = String(body.scheduleNo ?? "");
    const projectNo = body.projectNo === undefined || body.projectNo === "" ? "" : String(body.projectNo);
    if (!/^[0-9]{1,20}$/.test(scheduleNo) || (projectNo && !/^[0-9]{1,20}$/.test(projectNo))) return reply(req, { error: "invalid_schedule" }, 400);
    const { data: schedule, error: scheduleError } = await supabase.from("buildup_premeetings").select("crm_client_no,crm_project_no")
      .eq("organization_id", organizationId).eq("schedule_no", scheduleNo).maybeSingle();
    if (scheduleError) return reply(req, { error: "crm_lead_read_failed" }, 500);
    const clientNo = schedule?.crm_client_no || "";
    const project = schedule?.crm_project_no || projectNo;
    // One unambiguous active lead only; two matches are never guessed between.
    const findOne = async (column: string, value: string) => {
      const { data, error } = await supabase.from("leads").select("source_payload")
        .eq("organization_id", organizationId).is("archived_at", null).eq(column, value).limit(2);
      if (error) throw new Error("crm_lead_read_failed");
      return data?.length === 1 ? data[0] : null;
    };
    let row: any = null;
    try {
      if (clientNo) row = await findOne("source_payload->>id", "crm-" + clientNo) || await findOne("source_payload->crmSheet->>clientNo", clientNo);
      if (!row && project) row = await findOne("source_payload->>projNo", project);
    } catch { return reply(req, { error: "crm_lead_read_failed" }, 500); }
    if (!row) return reply(req, { ok: true, found: false });
    return reply(req, { ok: true, found: true, lead: crmLeadView(row.source_payload) });
  }

  // Meeting recordings: kept in the private bucket (signed URLs only), transcribed by CLOVA Speech on request.
  // Employees upload and transcribe their own recordings; OWNER/ADMIN may list, play and read others' (read-only).
  if (action === "audioUpload") {
    const checked = validateAudioUpload(body);
    if (!checked.ok) return reply(req, { error: checked.error }, checked.status);
    const value = checked.value;
    const { data: project, error: projectError } = await supabase.from("buildup_projects").select("project_id")
      .eq("organization_id", organizationId).eq("owner_user_id", me).eq("project_id", value.projectId).is("deleted_at", null).maybeSingle();
    if (projectError) return reply(req, { error: "audio_prepare_failed" }, 500);
    if (!project) return reply(req, { error: "project_not_found" }, 404);
    const { data: existing, error: existingError } = await supabase.from("buildup_recordings").select("id,status,storage_path,bytes")
      .eq("organization_id", organizationId).eq("owner_user_id", me).eq("project_id", value.projectId).eq("audio_key", value.audioKey).maybeSingle();
    if (existingError) return reply(req, { error: "audio_prepare_failed" }, 500);
    if (existing && existing.status !== "uploading") return reply(req, { ok: true, recordingId: existing.id, already: true, bytes: Number(existing.bytes) || 0 });
    let row: any = existing;
    if (!row) {
      const id = crypto.randomUUID();
      const { data: inserted, error: insertError } = await supabase.from("buildup_recordings").insert({
        id, organization_id: organizationId, owner_user_id: me, project_id: value.projectId, audio_key: value.audioKey,
        storage_path: audioPath(organizationId, me, value.projectId, id, value.mime), mime: value.mime, bytes: value.bytes, duration_sec: value.duration,
      }).select("id,storage_path").single();
      if (insertError) return insertError.code === "23505" ? reply(req, { error: "conflict" }, 409) : reply(req, { error: "audio_prepare_failed" }, 500);
      row = inserted;
    }
    const { data: signed, error: signError } = await supabase.storage.from(AUDIO_BUCKET).createSignedUploadUrl(row.storage_path, { upsert: true });
    if (signError || !signed?.token) return reply(req, { error: "audio_prepare_failed" }, 500);
    return reply(req, { ok: true, recordingId: row.id, path: row.storage_path, token: signed.token });
  }

  if (action === "audioUploaded") {
    const recordingId = String(body.recordingId || "");
    if (!RECORDING_ID.test(recordingId)) return reply(req, { error: "invalid_recording" }, 400);
    const { data: row, error } = await supabase.from("buildup_recordings").select("id,status,storage_path")
      .eq("organization_id", organizationId).eq("owner_user_id", me).eq("id", recordingId).maybeSingle();
    if (error) return reply(req, { error: "audio_read_failed" }, 500);
    if (!row) return reply(req, { error: "not_found" }, 404);
    const cut = row.storage_path.lastIndexOf("/"), folder = row.storage_path.slice(0, cut), name = row.storage_path.slice(cut + 1);
    const { data: files, error: listError } = await supabase.storage.from(AUDIO_BUCKET).list(folder, { search: name, limit: 10 });
    if (listError) return reply(req, { error: "audio_read_failed" }, 500);
    const file = (files || []).find((item: any) => item.name === name);
    if (!file) return reply(req, { error: "audio_missing" }, 409);
    const bytes = Math.max(0, Math.round(Number(file.metadata?.size) || 0));
    const patch: Record<string, unknown> = { bytes, updated_at: new Date().toISOString() };
    if (row.status === "uploading") patch.status = "uploaded";
    const { error: updateError } = await supabase.from("buildup_recordings").update(patch)
      .eq("organization_id", organizationId).eq("owner_user_id", me).eq("id", recordingId);
    if (updateError) return reply(req, { error: "audio_read_failed" }, 500);
    return reply(req, { ok: true, recordingId, bytes });
  }

  if (action === "recordings" || action === "audioUrl" || action === "transcript") {
    const ownerId = body.ownerId ? String(body.ownerId) : me;
    if (!UUID.test(ownerId)) return reply(req, { error: "invalid_recording" }, 400);
    if (!canReadBuildupOwner(access, ownerId)) return reply(req, { error: "permission_denied" }, 403);
    if (action === "recordings") {
      const projectId = String(body.projectId || "");
      if (!BUILDUP_ID.test(projectId)) return reply(req, { error: "invalid_recording" }, 400);
      const { data, error } = await supabase.from("buildup_recordings")
        .select("id,audio_key,status,bytes,duration_sec,speakers,error_code,requested_at,completed_at,created_at")
        .eq("organization_id", organizationId).eq("owner_user_id", ownerId).eq("project_id", projectId)
        .order("created_at", { ascending: true }).limit(AUDIO_LIMITS.listRows);
      if (error) return reply(req, { error: "audio_read_failed" }, 500);
      return reply(req, { ok: true, items: (data || []).map(recordingItem) });
    }
    if (action === "audioUrl") {
      const projectId = String(body.projectId || ""), audioKey = String(body.audioKey || "");
      if (!BUILDUP_ID.test(projectId) || !AUDIO_KEY.test(audioKey)) return reply(req, { error: "invalid_recording" }, 400);
      const { data: row, error } = await supabase.from("buildup_recordings").select("status,storage_path,mime")
        .eq("organization_id", organizationId).eq("owner_user_id", ownerId).eq("project_id", projectId).eq("audio_key", audioKey).maybeSingle();
      if (error) return reply(req, { error: "audio_read_failed" }, 500);
      if (!row || row.status === "uploading") return reply(req, { error: "not_found" }, 404);
      const { data: signed, error: signError } = await supabase.storage.from(AUDIO_BUCKET).createSignedUrl(row.storage_path, AUDIO_LIMITS.playUrlSec);
      if (signError || !signed?.signedUrl) return reply(req, { error: "audio_read_failed" }, 500);
      return reply(req, { ok: true, url: signed.signedUrl, mime: row.mime });
    }
    const recordingId = String(body.recordingId || "");
    if (!RECORDING_ID.test(recordingId)) return reply(req, { error: "invalid_recording" }, 400);
    const { data: row, error } = await supabase.from("buildup_recordings").select("id,status,speakers,error_code,completed_at,result")
      .eq("organization_id", organizationId).eq("owner_user_id", ownerId).eq("id", recordingId).maybeSingle();
    if (error) return reply(req, { error: "audio_read_failed" }, 500);
    if (!row) return reply(req, { error: "not_found" }, 404);
    const done = row.status === "done" && row.result && typeof row.result === "object";
    return reply(req, { ok: true, recordingId, status: row.status, speakers: row.speakers ?? null, errorCode: row.error_code || null, completedAt: row.completed_at || null,
      ...(done ? { segments: Array.isArray(row.result.segments) ? row.result.segments : [], labels: Array.isArray(row.result.speakers) ? row.result.speakers : [] } : {}) });
  }

  if (action === "transcribe") {
    const checked = validateTranscribe(body);
    if (!checked.ok) return reply(req, { error: checked.error }, checked.status);
    const invokeUrl = (Deno.env.get("CLOVA_SPEECH_INVOKE_URL") || "").trim().replace(/\/+$/, "");
    const sttSecret = (Deno.env.get("CLOVA_SPEECH_SECRET") || "").trim();
    if (!/^https:\/\/[^\s]+$/.test(invokeUrl) || !sttSecret) return reply(req, { error: "stt_not_configured" }, 503);
    const value = checked.value;
    const { data: row, error } = await supabase.from("buildup_recordings").select("id,status,storage_path,requested_at")
      .eq("organization_id", organizationId).eq("owner_user_id", me).eq("id", value.recordingId).maybeSingle();
    if (error) return reply(req, { error: "audio_read_failed" }, 500);
    if (!row) return reply(req, { error: "not_found" }, 404);
    if (row.status === "uploading") return reply(req, { error: "audio_missing" }, 409);
    if (row.status === "processing" && !processingIsStale(row.requested_at)) return reply(req, { ok: true, recordingId: row.id, status: "processing" });
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count, error: countError } = await supabase.from("buildup_recordings").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("owner_user_id", me).gte("requested_at", since);
    if (countError) return reply(req, { error: "audio_read_failed" }, 500);
    if (transcribeRateLimited(count)) return reply(req, { error: "stt_rate_limited" }, 429);
    const { data: media, error: mediaError } = await supabase.storage.from(AUDIO_BUCKET).createSignedUrl(row.storage_path, AUDIO_LIMITS.mediaUrlSec);
    if (mediaError || !media?.signedUrl) return reply(req, { error: "audio_missing" }, 409);
    // The job is marked first so that a fast callback finds its (hashed) secret.
    const callbackSecret = newCallbackSecret();
    const now = new Date().toISOString();
    const { error: markError } = await supabase.from("buildup_recordings").update({
      status: "processing", stt_provider: "clova", stt_token: null, callback_hash: await secretHash(callbackSecret), speakers: value.speakers,
      error_code: null, result: null, requested_at: now, completed_at: null, updated_at: now,
    }).eq("organization_id", organizationId).eq("owner_user_id", me).eq("id", row.id);
    if (markError) return reply(req, { error: "audio_read_failed" }, 500);
    const callback = `${Deno.env.get("SUPABASE_URL")}/functions/v1/kpi-buildup-stt-callback?r=${row.id}&k=${callbackSecret}`;
    let upstream: Response | null = null, started: any = null;
    try {
      upstream = await fetch(`${invokeUrl}/recognizer/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json", "X-CLOVASPEECH-API-KEY": sttSecret },
        body: JSON.stringify(clovaRequest({ url: media.signedUrl, callback, speakers: value.speakers, keywords: value.keywords })),
      });
      try { started = await upstream.json(); } catch { started = null; }
    } catch { upstream = null; }
    const jobToken = typeof started?.token === "string" ? started.token.slice(0, 200) : "";
    if (!upstream || !upstream.ok || !jobToken) {
      const mapped = upstream ? clovaStartError(upstream.ok ? 502 : upstream.status) : { status: 502, error: "stt_upstream_error" };
      await supabase.from("buildup_recordings").update({ status: "failed", callback_hash: null, error_code: mapped.error, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId).eq("owner_user_id", me).eq("id", row.id);
      return reply(req, { error: mapped.error }, mapped.status);
    }
    await supabase.from("buildup_recordings").update({ stt_token: jobToken }).eq("organization_id", organizationId).eq("owner_user_id", me).eq("id", row.id).eq("status", "processing");
    return reply(req, { ok: true, recordingId: row.id, status: "processing" });
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
      const mapped = aiUpstreamError(upstream.status, message);
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
