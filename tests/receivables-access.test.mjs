import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { validateReceivablesMutation as valid } from '../supabase/functions/_shared/receivables-access.mjs';
const state = { leads: [{ id: 'l', status: '계약 완료', history: [{ note: 'synthetic previous' }] }, { id: 'new', status: '신규 DB' }], contractStatusLogs: [{ id: 'old' }] };
const mutation = (field = 'vendorNote', value = 'synthetic') => ({ schemaVersion: 3, origin: 'user', documents: {}, deleteDocuments: [], changedCount: 1,
  collections: { leads: { idField: 'id', upsert: [], remove: [], patches: [{ id: 'l', ops: [{ op: 'set', path: [field], value }] }] } } });
test('two-page edits: amounts, receipts, dates, owners, notes and status', () => {
  for (const [field,value] of [['vendorNote','test'],['vendorImportStatus','완료'],['vendorImportPaymentState','입금완료'],['contractAmount',100],['expected',100],['paid',50],['premeetingDoneAt','2026-10-08'],['salesOwner','test'],['status','견적·제안 발송'],['payments',[{ id:'p',amount:50,paidConfirmed:true }]],['history',[{ note:'new' }, ...state.leads[0].history]]]) assert.equal(valid(mutation(field,value),state),true,field);
});
test('unrelated fields, documents, leads, creation/deletion, history erasure and path escapes denied', () => {
  for (const field of ['id','createdAt','channel','crmSheet','archived_at','__proto__']) assert.equal(valid(mutation(field),state),false,field);
  for (const change of [m=>m.collections.leads.patches[0].id='new', m=>m.collections.leads.patches[0].id='missing', m=>m.collections.leads.upsert.push({id:'fresh',status:'계약 완료'}),m=>m.collections.leads.remove.push('l'),m=>m.documents.adSpend={},m=>m.documents.ui={},m=>m.deleteDocuments.push('users'),m=>m.collections.products={},m=>m.collections.leads.patches[0].ops[0].path=['score','__proto__','x'],m=>m.origin='system']) { const m=mutation();change(m);assert.equal(valid(m,state),false); }
  assert.equal(valid(mutation('history',[]),state),false);
  assert.equal(valid(mutation('payments',[{id:'p',amount:-1}]),state),false);
  assert.equal(valid(mutation('contractAmount',-1),state),false);
  assert.equal(valid(mutation('status','신규 DB'),state),false);
});
test('activity logs are append-only and refer to eligible existing leads', () => {
  const m=mutation();m.collections.contractStatusLogs={idField:'id',patches:[],remove:[],upsert:[{id:'fresh',leadId:'l',detail:'synthetic'}]};
  assert.equal(valid(m,state),true);m.collections.contractStatusLogs.upsert[0].id='old';assert.equal(valid(m,state),false);
  m.collections.contractStatusLogs.upsert[0]={id:'fresh',leadId:'new'};assert.equal(valid(m,state),false);
});
test('scoped prepare sends journaled user intent, not display migrations; journal stays until ACK', () => {
  const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
  const baseline=JSON.stringify(state), entries=[{id:'pending',mutation:mutation()}];
  const scope={window:{crmLastRemoteValue:baseline,crmPendingDbMutations:entries},localStorage:{removeItem(){},setItem(){}},CRM_LOCAL_DIRTY_KEY:'dirty',CRM_PENDING_MUTATIONS_KEY:'pending',isScopedReceivablesWriter:()=>true,JSON,Date,Math};
  vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('  var CRM_COLLECTION_ID_FIELDS ='),source.indexOf('  function crmSubmitMutationV3')),scope);
  vm.runInContext(source.slice(source.indexOf('  function crmPrepareStateMutation('),source.indexOf('  function crmPostPreparedMutationV3(')),scope);
  const prepared=scope.crmPrepareStateMutation(JSON.stringify({...state,adSpend:{x:99},leads:[]}),{});
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.mutation.collections.leads)),mutation().collections.leads);
  assert.equal(Object.keys(prepared.mutation.documents).length,0);
  assert.equal(scope.window.crmPendingDbMutations.length,1);
  assert.deepEqual(Array.from(prepared.pendingMutationIds),['pending']);
  scope.crmAcknowledgePendingMutations(prepared.pendingMutationIds);assert.equal(scope.window.crmPendingDbMutations.length,0);
});
