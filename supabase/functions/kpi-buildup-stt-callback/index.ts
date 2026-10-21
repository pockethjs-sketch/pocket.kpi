import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { AUDIO_LIMITS, RECORDING_ID, clovaResult, secretHash, sameDigest } from "../_shared/buildup-audio.mjs";

// CLOVA Speech result callback for buildup precise transcription.
// verify_jwt = false because CLOVA cannot send a Supabase JWT. Instead every request must carry the single-use
// per-recording secret that kpi-buildup-api created when it started the job: only its SHA-256 is stored, it is
// cleared on first use (or replaced when the job is restarted), and it lets the caller write only that recording's
// transcript while the job is processing. Nothing is read back to the caller and payloads are never logged.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = new URL(req.url);
  const recordingId = url.searchParams.get("r") || "", secret = url.searchParams.get("k") || "";
  if (!RECORDING_ID.test(recordingId) || !/^[0-9a-f]{64}$/.test(secret)) return json({ error: "unauthorized" }, 401);
  if (Number(req.headers.get("content-length") || 0) > AUDIO_LIMITS.callbackBytes) return json({ error: "payload_too_large" }, 413);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: row, error } = await supabase.from("buildup_recordings").select("id,status,callback_hash").eq("id", recordingId).maybeSingle();
  if (error) return json({ error: "unavailable" }, 503);
  if (!row || row.status !== "processing" || !sameDigest(await secretHash(secret), row.callback_hash)) return json({ error: "unauthorized" }, 401);

  let text = "";
  try { text = await req.text(); } catch { return json({ error: "bad_request" }, 400); }
  if (text.length > AUDIO_LIMITS.callbackBytes) return json({ error: "payload_too_large" }, 413);
  let payload: unknown = null;
  try { payload = JSON.parse(text); } catch { payload = null; }
  const parsed: any = clovaResult(payload);
  const now = new Date().toISOString();
  const patch = parsed.status === "done"
    ? { status: "done", result: { segments: parsed.segments, speakers: parsed.speakers }, error_code: null, callback_hash: null, completed_at: now, updated_at: now }
    : { status: "failed", error_code: parsed.error, callback_hash: null, completed_at: now, updated_at: now };
  // Only the job that still holds this secret is written (a restarted job has a new secret).
  const { data: updated, error: updateError } = await supabase.from("buildup_recordings").update(patch)
    .eq("id", recordingId).eq("status", "processing").eq("callback_hash", row.callback_hash).select("id");
  if (updateError) return json({ error: "unavailable" }, 503);
  if (!updated?.length) return json({ error: "unauthorized" }, 401);
  return json({ ok: true });
});
