import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const edge = await readFile(new URL("../supabase/functions/kpi-shadow-gateway/index.ts", import.meta.url), "utf8");
const queue = await readFile(new URL("../supabase/migrations/20260907100000_shadow_gateway_queue.sql", import.meta.url), "utf8");
const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");

test("gateway requires a timestamped HMAC and server-only service key", () => {
  assert.match(edge, /KPI_SHADOW_HMAC_SECRET/);
  assert.match(edge, /x-kpi-timestamp/);
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(edge, /eyJ[A-Za-z0-9_-]{20,}/);
});

test("custom HMAC is the public edge boundary when platform JWT verification is disabled", () => {
  assert.match(config, /\[functions\.kpi-shadow-gateway\][\s\S]*verify_jwt = false/);
  assert.match(edge, /if \(!\(await verify\(req, raw, rawBytes\)\)\)/);
  assert.match(edge, /x-kpi-body-sha256/);
});

test("gateway writes idempotency, ownership claims, audit, and durable queue", () => {
  for (const token of ["idempotency_keys", "field_ownership_claims", "audit_events", "shadow_mutation_queue"]) assert.match(edge + queue, new RegExp(token));
  assert.match(queue, /revoke all on public\.shadow_mutation_queue, public\.shadow_state_snapshots from anon, authenticated/);
});

test("gateway reads the single current state with legacy snapshot fallback", () => {
  assert.match(edge, /from\("app_current_state"\)/);
  assert.match(edge, /source: "app_current_state"/);
  assert.match(edge, /source: "legacy_snapshot"/);
});
