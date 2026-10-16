import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261016005608_crm_premeeting_server_reconciliation.sql',import.meta.url),'utf8');
test('stored premeeting writer stays invoker/server-only and verifies actual list plus dates',()=>{
  assert.match(sql,/security invoker/);assert.doesNotMatch(sql,/security definer/i);
  assert.match(sql,/from public,anon,authenticated/);assert.match(sql,/to service_role/);
  assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/commit_primary_mutation/);
  assert.match(sql,/distinct on\(external_id\)/);assert.match(sql,/last_seen_at desc,id desc/);
  assert.match(sql,/sl=l.source_payload/);assert.match(sql,/stored_daily<>daily/);
  assert.match(sql,/견적·제안 발송/);assert.match(sql,/premeeting_projection_mismatch/);
  assert.doesNotMatch(sql,/private\.kpi_try_|set statement_timeout|grant.*private/i);
  assert.match(sql,/for item in select distinct on\(l->>'id'\)/);
});
test('projection optimization preserves full derived-column drift repair and revision/archive parity',()=>{
  const perf=readFileSync(new URL('../supabase/migrations/20261016005606_optimize_projection_payload_reuse.sql',import.meta.url),'utf8');
  assert.match(perf,/source_payload,account_id,external_crm_id,acquired_on/);
  assert.match(perf,/source_payload,account_id,lead_id,external_crm_id/);
  assert.match(perf,/is distinct from/);assert.match(perf,/set projected_revision = p_revision/);
  assert.doesNotMatch(perf,/statement_timeout|alter role|grant |delete from /i);
});
