import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const encoder = new TextEncoder();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function verify(req: Request, raw: string, rawBytes: Uint8Array) {
  const secret = Deno.env.get("KPI_SHADOW_HMAC_SECRET") || "";
  const timestamp = req.headers.get("x-kpi-timestamp") || "";
  const supplied = req.headers.get("x-kpi-signature") || "";
  if (!secret || !timestamp || !supplied) return false;
  const epoch = Number(timestamp);
  if (!Number.isFinite(epoch) || Math.abs(Date.now() - epoch) > 5 * 60_000) return false;
  const suppliedBodyHash = req.headers.get("x-kpi-body-sha256") || "";
  let signedValue = timestamp + "." + raw;
  if (suppliedBodyHash) {
    const actualBodyHash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", rawBytes)));
    if (actualBodyHash !== suppliedBodyHash) return false;
    signedValue = timestamp + "." + suppliedBodyHash;
  }
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signedValue))));
  if (expected.length !== supplied.length) return false;
  let mismatch = 0; for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0;
}

function ownershipClaims(mutation: Record<string, unknown>) {
  if (String(mutation.origin || "") !== "user") return [];
  const claims: Array<Record<string, string>> = [];
  const collections = (mutation.collections || {}) as Record<string, any>;
  for (const [entityType, change] of Object.entries(collections)) {
    for (const patch of change.patches || []) for (const op of patch.ops || []) claims.push({ entityType, sourceId: String(patch.id), fieldPath: (op.path || []).join("."), ownerSource: "USER" });
    for (const item of change.upsert || []) claims.push({ entityType, sourceId: String(item[change.idField] || ""), fieldPath: "*", ownerSource: "USER" });
  }
  return claims;
}

const chunks = <T>(rows: T[], size = 200) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
async function upsertChunks(supabase: any, table: string, rows: any[], onConflict: string) {
  for (const part of chunks(rows)) { const { error } = await supabase.from(table).upsert(part, { onConflict }); if (error) throw new Error(`${table}:${error.code}`); }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const rawBytes = new Uint8Array(await req.arrayBuffer());
  const raw = new TextDecoder().decode(rawBytes);
  if (!(await verify(req, raw, rawBytes))) return json({ error: "unauthorized" }, 401);
  let body: any; try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const organizationId = Deno.env.get("KPI_ORGANIZATION_ID") || "";
  if (!organizationId) return json({ error: "organization_not_configured" }, 503);

  if (body.action === "mutation_status") {
    if (!body.mutationId) return json({ error: "missing_mutation_id" }, 400);
    const { data, error } = await supabase.from("idempotency_keys").select("status,response")
      .eq("organization_id", organizationId).eq("key", String(body.mutationId)).maybeSingle();
    if (error) return json({ error: "mutation_status_failed" }, 500);
    return json({ ok: true, found: Boolean(data), status: data?.status || null, response: data?.response || null });
  }

  if (body.action === "primary_commit") {
    if (!body.mutationId || !body.baseRevision || !body.nextRevision || !body.mutation || !body.stateSnapshot) {
      return json({ error: "missing_primary_fields" }, 400);
    }
    const requestHash = await crypto.subtle.digest("SHA-256", encoder.encode(raw)).then((x) => hex(new Uint8Array(x)));
    const { data, error } = await supabase.rpc("commit_primary_state", {
      p_organization_id: organizationId,
      p_mutation_id: String(body.mutationId),
      p_base_revision: String(body.baseRevision),
      p_next_revision: String(body.nextRevision),
      p_request_hash: requestHash,
      p_mutation: body.mutation,
      p_state_snapshot: body.stateSnapshot,
      p_field_ownership_claims: ownershipClaims(body.mutation),
    });
    if (error) return json({ error: "primary_commit_failed", code: error.code }, 500);
    if (!data?.ok) return json(data || { error: "primary_commit_rejected" }, data?.error === "revision_conflict" ? 409 : 400);
    return json({ ...data, primary: "supabase" });
  }

  if (body.action === "enqueue") {
    if (!body.mutationId || !body.primaryRevision || !body.mutation) return json({ error: "missing_fields" }, 400);
    const requestHash = await crypto.subtle.digest("SHA-256", encoder.encode(raw)).then((x) => hex(new Uint8Array(x)));
    const { data: existing } = await supabase.from("idempotency_keys").select("request_hash,status,response").eq("organization_id", organizationId).eq("key", body.mutationId).maybeSingle();
    if (existing) {
      if (existing.request_hash !== requestHash) return json({ error: "idempotency_conflict" }, 409);
      return json({ ok: true, duplicate: true, status: existing.status, response: existing.response });
    }
    const prepared = { organization_id: organizationId, key: body.mutationId, operation: "SHEETS_V3_SHADOW", request_hash: requestHash, status: "PREPARE" };
    const { error: keyError } = await supabase.from("idempotency_keys").insert(prepared); if (keyError) return json({ error: "idempotency_insert_failed" }, 500);
    const queueRow = { organization_id: organizationId, mutation_id: body.mutationId, primary_revision: body.primaryRevision, mutation: body.mutation, state_snapshot: body.stateSnapshot || null, field_ownership_claims: ownershipClaims(body.mutation) };
    const { error: queueError } = await supabase.from("shadow_mutation_queue").insert(queueRow);
    if (queueError) { await supabase.from("idempotency_keys").update({ status: "FAILED", response: { error: queueError.code } }).eq("organization_id", organizationId).eq("key", body.mutationId); return json({ error: "queue_insert_failed" }, 500); }
    if (body.stateSnapshot) await supabase.from("shadow_state_snapshots").upsert({ organization_id: organizationId, primary_revision: body.primaryRevision, state_snapshot: body.stateSnapshot, source_mutation_id: body.mutationId }, { onConflict: "organization_id,primary_revision" });
    await supabase.from("audit_events").insert({ organization_id: organizationId, entity_type: "shadow_mutation", action_code: "ENQUEUED", source: "GOOGLE_SHEETS", idempotency_key: body.mutationId, metadata: { primaryRevision: body.primaryRevision } });
    await supabase.from("idempotency_keys").update({ status: "COMMIT", response: { queued: true, primaryRevision: body.primaryRevision } }).eq("organization_id", organizationId).eq("key", body.mutationId);
    return json({ ok: true, queued: true, mutationId: body.mutationId });
  }
  if (body.action === "import") {
    const entities = body.entities || {};
    if (!body.runId || !body.sourceHash || !entities.organizationSlug) return json({ error: "missing_import_fields" }, 400);
    const { data: oldRun } = await supabase.from("migration_runs").select("id,status,checkpoint").eq("id", body.runId).maybeSingle();
    if (oldRun?.status === "VERIFIED") return json({ ok: true, duplicate: true, complete: true, checkpoint: oldRun.checkpoint });
    await supabase.from("migration_runs").upsert({ id: body.runId, organization_id: organizationId, source_name: "GOOGLE_SHEETS_V3", source_revision: body.sourceRevision, status: "RUNNING", dry_run: false, checkpoint: { entity: "accounts", offset: 0 } });
    try {
      await upsertChunks(supabase, "accounts", (entities.accounts || []).map((x: any) => ({ organization_id: organizationId, name: x.name, normalized_name: x.normalizedName || String(x.name).toLowerCase(), external_crm_id: x.externalCrmId || null, source: x.source, source_row_key: x.sourceRowKey, field_owners: x.fieldOwners || {} })), "organization_id,source,source_row_key");
      const { data: accountRows, error: accountError } = await supabase.from("accounts").select("id,source_row_key").eq("organization_id", organizationId); if (accountError) throw accountError;
      const accountMap = new Map((accountRows || []).map((x: any) => [x.source_row_key, x.id]));
      await upsertChunks(supabase, "leads", (entities.leads || []).map((x: any) => ({ organization_id: organizationId, account_id: accountMap.get(x.accountRowKey), external_crm_id: x.externalCrmId || null, source: x.source, source_row_key: x.sourceRowKey, acquired_on: x.acquiredOn, channel: x.channel, status_code: x.statusCode, notes: x.notes, field_owners: x.fieldOwners || {} })), "organization_id,source,source_row_key");
      const { data: leadRows, error: leadError } = await supabase.from("leads").select("id,source_row_key").eq("organization_id", organizationId); if (leadError) throw leadError;
      const leadMap = new Map((leadRows || []).map((x: any) => [String(x.source_row_key).replace(/^lead:/, ""), x.id]));
      await upsertChunks(supabase, "deals", (entities.deals || []).map((x: any) => ({ organization_id: organizationId, account_id: accountMap.get(x.accountRowKey), lead_id: leadMap.get(x.leadRowKey), external_crm_id: x.externalCrmId || null, source: x.source, source_row_key: x.sourceRowKey, service_code: x.serviceCode, stage_code: x.stageCode, quoted_amount: x.quotedAmount, contract_amount: x.contractAmount, contracted_on: x.contractedOn, field_owners: x.fieldOwners || {} })), "organization_id,source,source_row_key");
      const { data: dealRows, error: dealError } = await supabase.from("deals").select("id,source_row_key").eq("organization_id", organizationId); if (dealError) throw dealError;
      const dealMap = new Map((dealRows || []).map((x: any) => [x.source_row_key, x.id]));
      await upsertChunks(supabase, "payment_plans", (entities.payments || []).map((x: any) => ({ organization_id: organizationId, deal_id: dealMap.get(x.dealRowKey), installment_code: x.installmentCode, planned_amount: x.plannedAmount, due_on: x.dueOn, status: x.status, source: x.source, source_row_key: x.sourceRowKey, field_owners: x.fieldOwners || {} })), "organization_id,source,source_row_key");
      const { data: planRows } = await supabase.from("payment_plans").select("id,source_row_key").eq("organization_id", organizationId);
      const planMap = new Map((planRows || []).map((x: any) => [x.source_row_key, x.id]));
      await upsertChunks(supabase, "payment_receipts", (entities.paymentReceipts || []).map((x: any) => ({ organization_id: organizationId, payment_plan_id: x.paymentRowKey ? planMap.get(x.paymentRowKey) : null, deal_id: dealMap.get(x.dealRowKey), received_amount: x.receivedAmount, received_on: x.receivedOn, payment_method: x.paymentMethod || null, note: x.note || null, source: x.source, source_row_key: x.sourceRowKey })), "organization_id,source,source_row_key");
      await upsertChunks(supabase, "contract_events", (entities.contractEvents || []).filter((x: any) => dealMap.has(x.dealRowKey)).map((x: any) => ({ organization_id: organizationId, deal_id: dealMap.get(x.dealRowKey), event_type: x.eventType, event_at: x.eventAt, contract_amount: x.contractAmount, confirmed_receipt_amount: x.confirmedReceiptAmount, source: x.source, source_row_key: x.sourceRowKey, source_hash: x.sourceHash, payload: x.payload || {} })), "organization_id,source,source_row_key,source_hash");
      await upsertChunks(supabase, "marketing_daily_spend", (entities.marketingDaily || []).map((x: any) => ({ organization_id: organizationId, spend_date: x.spendDate, provider: x.provider, channel_code: x.channelCode, spend_amount: x.spendAmount, impressions: x.impressions, clicks: x.clicks, conversions: x.conversions, source_row_key: x.sourceRowKey, source_hash: x.sourceHash || null })), "organization_id,provider,spend_date,campaign_external_id,source_row_key");
      await upsertChunks(supabase, "deal_activity", (entities.dealActivity || []).map((x: any) => ({ organization_id: organizationId, deal_id: x.dealRowKey ? dealMap.get(x.dealRowKey) || null : null, action_code: x.actionCode, path: x.path, detail: x.detail, source: x.source, occurred_at: x.occurredAt, source_row_key: x.sourceRowKey, metadata: x.metadata || {} })), "organization_id,source,source_row_key");
      const tableFor: Record<string, string> = { accounts: "accounts", leads: "leads", deals: "deals", payments: "payment_plans", paymentReceipts: "payment_receipts", contractEvents: "contract_events", marketingDaily: "marketing_daily_spend", dealActivity: "deal_activity" };
      const targetCounts: Record<string, number> = {};
      for (const [domain, table] of Object.entries(tableFor)) { const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true }).eq("organization_id", organizationId); if (error) throw error; targetCounts[domain] = count || 0; }
      const { data: financeRows, error: financeError } = await supabase.from("deal_financial_summary").select("quoted_amount,contract_amount,planned_amount,received_amount,outstanding_amount").eq("organization_id", organizationId); if (financeError) throw financeError;
      const { data: spendRows, error: spendError } = await supabase.from("marketing_daily_spend").select("spend_amount").eq("organization_id", organizationId).is("archived_at", null); if (spendError) throw spendError;
      const total = (rows: any[], field: string) => rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
      const targetTotals = { quotedAmount: total(financeRows || [], "quoted_amount"), contractAmount: total(financeRows || [], "contract_amount"), plannedAmount: total(financeRows || [], "planned_amount"), receivedAmount: total(financeRows || [], "received_amount"), outstandingAmount: total(financeRows || [], "outstanding_amount"), marketingSpend: total(spendRows || [], "spend_amount") };
      const countMismatch = Object.entries(body.reconciliation?.counts || {}).filter(([domain, count]) => targetCounts[domain] !== Number(count));
      const amountMismatch = Object.entries(body.reconciliation?.totals || {}).filter(([field, amount]) => Math.abs((targetTotals as any)[field] - Number(amount)) > 0.01);
      if (countMismatch.length || amountMismatch.length) throw new Error(`reconciliation_mismatch:counts=${JSON.stringify(countMismatch)}:amounts=${JSON.stringify(amountMismatch)}`);
      const checkpoint = { entity: "complete", offset: Object.values(entities).filter(Array.isArray).reduce((n: number, rows: any) => n + rows.length, 0), sourceHash: body.sourceHash };
      await supabase.from("migration_runs").update({ status: "VERIFIED", completed_at: new Date().toISOString(), checkpoint }).eq("id", body.runId);
      for (const [entityType, sourceRows] of Object.entries(body.reconciliation?.counts || {})) await supabase.from("migration_reconciliation").insert({ migration_run_id: body.runId, entity_type: entityType, source_rows: sourceRows, target_rows: targetCounts[entityType], details: { sourceHash: body.sourceHash } });
      return json({ ok: true, complete: true, checkpoint, reconciliation: { counts: targetCounts, totals: targetTotals } });
    } catch (error) {
      await supabase.from("migration_runs").update({ status: "FAILED", completed_at: new Date().toISOString(), error_detail: String(error) }).eq("id", body.runId);
      return json({ error: "import_failed", detail: String(error) }, 500);
    }
  }
  if (body.action === "snapshot") {
    const { data, error } = await supabase.from("shadow_state_snapshots").select("primary_revision,state_snapshot,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return error ? json({ error: "snapshot_read_failed" }, 500) : json({ ok: true, revision: data?.primary_revision || null, snapshot: data?.state_snapshot || null });
  }
  return json({ error: "unknown_action" }, 400);
});
