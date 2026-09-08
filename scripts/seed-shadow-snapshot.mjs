import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const input = process.argv[2];
const url = process.env.KPI_SUPABASE_MIGRATION_URL || "";
const secret = process.env.KPI_SHADOW_HMAC_SECRET || "";
if (!input || !url || !secret) throw new Error("input, KPI_SUPABASE_MIGRATION_URL and KPI_SHADOW_HMAC_SECRET are required");
const stateSnapshot = JSON.parse(await readFile(input, "utf8"));
const mutationId = `initial-snapshot-${randomUUID()}`;
const bodyText = JSON.stringify({
  action: "enqueue",
  mutationId,
  primaryRevision: String(stateSnapshot.revision || "unknown"),
  mutation: { origin: "system", reason: "initial_supabase_cutover", collections: {} },
  stateSnapshot,
});
const timestamp = String(Date.now());
const signature = createHmac("sha256", secret).update(`${timestamp}.${bodyText}`).digest("hex");
const response = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-kpi-timestamp": timestamp, "x-kpi-signature": signature },
  body: bodyText,
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(`snapshot seed failed: HTTP ${response.status} ${result.error || "unknown"}`);
console.log(JSON.stringify({ ok: true, revision: stateSnapshot.revision, leads: stateSnapshot.leads?.length || 0, queued: result.queued }));
