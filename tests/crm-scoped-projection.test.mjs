import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../scripts/crm-scoped-projection.sql',import.meta.url),'utf8');
test('CRM delta only projects companies and never financial/archived relations',()=>{
  assert.match(sql,/security invoker set search_path = ''/);
  assert.doesNotMatch(sql,/\b(?:insert into|update|delete from) public\.(?:deals|payment_plans|payment_receipts|contract_events)\b/i);
  assert.doesNotMatch(sql,/archived_at\s*=\s*null|grant |alter role|statement_timeout/i);
  assert.match(sql,/crm_delta_protected_field_changed/);
  assert.match(sql,/crm_delta_existing_or_archived_identity/);
  assert.match(sql,/crm_delta_new_finance_forbidden/);
  assert.match(sql,/crm_delta_post_projection_mismatch/);
  assert.match(sql,/from public,anon,authenticated,service_role/);
});
test('CRM bulk assembly preserves array order and rejects deletion/document/duplicate input',()=>{
  const batch=readFileSync(new URL('../scripts/crm-batched-mutation.sql',import.meta.url),'utf8');
  assert.match(batch,/order by position/);assert.match(batch,/crm_batch_scope_invalid/);
  assert.match(batch,/crm_batch_duplicate_id/);assert.match(batch,/crm_batch_id_missing/);
  assert.doesNotMatch(batch,/security definer|grant |statement_timeout/i);
});
test('existing atomic commit selects the scoped writer only for validated CRM promotions',()=>{
  assert.match(sql,/p_mutation->>'origin'='crm'/);
  assert.match(sql,/'server-inflow-reconciliation','stored_premeeting_sync'/);
  assert.match(sql,/v_current.state_snapshot,v_next_state/);
  assert.match(sql,/else\s+v_projection := private.project_v3_state/);
  assert.match(sql,/crm_delta_other_document_changed/);
  assert.match(sql,/crm_delta_log_lost/);
  assert.match(sql,/crm_delta_identity_or_delete/);
});
