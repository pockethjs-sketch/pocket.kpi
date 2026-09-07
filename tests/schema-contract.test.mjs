import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const core = await readFile(new URL("../supabase/migrations/20260907090000_kpi_crm_core.sql", import.meta.url), "utf8");
const security = await readFile(new URL("../supabase/migrations/20260907091000_kpi_crm_security.sql", import.meta.url), "utf8");
const ownership = await readFile(new URL("../supabase/migrations/20260907092000_kpi_restore_and_ownership.sql", import.meta.url), "utf8");
const rollback = await readFile(new URL("../supabase/rollback/20260907090000_kpi_crm_core.down.sql", import.meta.url), "utf8");
const queue = await readFile(new URL("../supabase/migrations/20260907100000_shadow_gateway_queue.sql", import.meta.url), "utf8");

test("financial meanings use separate columns and reconciliation view", () => {
  for (const token of ["quoted_amount", "contract_amount", "planned_amount", "received_amount", "outstanding_amount"]) assert.match(core + security, new RegExp(token));
});

test("destructive rollback is blocked after a verified import", () => {
  assert.match(rollback, /rollback_blocked_verified_migration_exists/);
});

test("user-owned fields and soft-delete restore are explicit contracts", () => {
  assert.match(core, /entity_field_ownership/);
  assert.match(ownership, /owner_source='USER' and incoming_source <> 'USER' then false/);
  assert.match(ownership, /restore_archived_record/);
});

test("all public business tables are in the RLS activation list", () => {
  const tables = [...core.matchAll(/create table public\.([a-z_]+)/g)].map((m) => m[1]);
  for (const table of tables) assert.match(security, new RegExp("'" + table + "'"));
  assert.match(security, /force row level security/i);
  assert.match(security, /append_only/i);
});

test("browser roles cannot write server-only ledgers", () => {
  assert.match(security, /revoke all on public\.idempotency_keys, public\.audit_events/);
  assert.doesNotMatch(security, /grant\s+(insert|update|delete).*authenticated/i);
});

test("shadow tables are RLS-forced and inaccessible to browser roles", () => {
  assert.match(queue, /force row level security/);
  assert.match(queue, /revoke all on public\.shadow_mutation_queue/);
});
