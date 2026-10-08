import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
function runtime() {
  const values = new Map();
  const calls = [];
  let fail = false;
  const scope = {
    isScopedReceivablesWriter: () => false,
    window: { crmRemoteRevision: 'r1', crmRemoteLoaded: true, crmRemoteApplied: true,
      crmPendingDbMutations: [], crmSaveQueue: Promise.resolve() },
    localStorage: { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) },
    CRM_SHEET_URL: 'https://example.invalid', CRM_LOCAL_DIRTY_KEY: 'dirty',
    CRM_PENDING_MUTATIONS_KEY: 'journal', CRM_REMOTE_REVISION_KEY: 'revision', CRM_REMOTE_HASH_KEY: 'hash',
    shadowStatusFromSheetsResult: () => ({}),
    crmFetchDomainAction: async (action, options) => {
      calls.push({action, body:options.body});
      if (fail) throw new Error('synthetic_network_failure');
      assert.equal(Object.hasOwn(options.body.mutation.documents, 'auth'), false);
      assert.equal(options.body.mutation.deleteDocuments.includes('auth'), false);
      return {ok:true, revision:'r2', storageVersion:2, mutationVersion:3};
    },
  };
  vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('  var CRM_COLLECTION_ID_FIELDS ='), source.indexOf('  /* ===== 지원사업 보드 인증 저장본')), scope);
  return {scope, calls, values, setFail: value => {fail=value;}};
}
const base = () => ({leads:[{id:'synthetic-1',paid:0,payments:[]}],users:[],ui:{me:'synthetic'}});
const legacy = {enabled:true,accounts:[]};
test('top-level legacy auth creation, update and deletion never enter mutation', () => {
  const {scope:s}=runtime();
  for(const [a,b] of [[base(),{...base(),auth:legacy}],[{...base(),auth:legacy},base()],
    [{...base(),auth:legacy},{...base(),auth:{enabled:false}}]]) {
    const m=s.crmBuildMutation(JSON.stringify(a),JSON.stringify(b));
    assert.equal(m.changedCount,0); assert.deepEqual(Object.keys(m.documents),[]);
    assert.equal(m.deleteDocuments.length,0);
  }
});
test('business payments, memo and nested auth fields are not stripped', () => {
  const {scope:s}=runtime(), next=base();next.auth=legacy;
  next.leads[0]={...next.leads[0],paid:100,payments:[{id:'p1',amount:100,paidConfirmed:true}],memo:'synthetic note',auth:{custom:true}};
  const m=s.crmBuildMutation(JSON.stringify(base()),JSON.stringify(next));
  assert.equal(m.changedCount,1);assert.equal(Object.hasOwn(m.documents,'auth'),false);
  const applied=s.crmApplyMutationLocal(base(),m);
  assert.deepEqual(JSON.parse(JSON.stringify(applied.leads)),next.leads);
});
test('failed mixed journal replays business changes; failure preserves journal until successful ACK', async () => {
  const r=runtime(),s=r.scope, initial=base();
  const entry={id:'old-rejected',mutation:{changedCount:2,documents:{auth:legacy},collections:{leads:{idField:'id',patches:[{id:'synthetic-1',ops:[{op:'set',path:['paid'],value:100}]}]}}},createdAt:'synthetic'};
  s.window.crmPendingDbMutations=[entry];s.crmPersistPendingMutations();
  const replay=s.crmConsumePendingMutations(initial);
  assert.equal(replay.state.leads[0].paid,100);
  s.window.crmLastRemoteValue=s.window.crmOptimisticRemoteValue=JSON.stringify(initial);
  r.setFail(true);
  await assert.rejects(s.window.storage.set('state',JSON.stringify(replay.state),replay.saveOptions));
  assert.equal(s.window.crmPendingDbMutations.length,1);
  assert.equal(JSON.parse(r.values.get('journal'))[0].id,'old-rejected');
  // A fresh authenticated DB baseline, as on reload, rebuilds a new request.
  s.window.crmLastRemoteValue=s.window.crmOptimisticRemoteValue=JSON.stringify(initial);
  r.setFail(false);
  await s.window.storage.set('state',JSON.stringify(replay.state),replay.saveOptions);
  assert.equal(r.calls.length,2);
  assert.equal(r.calls[1].body.mutation.collections.leads.patches[0].ops[0].value,100);
  assert.equal(s.window.crmPendingDbMutations.length,0);
  assert.equal(r.values.has('dirty'),false);
});
test('auth-only journal acknowledges locally without a business write', async () => {
  const {scope:s,calls}=runtime();
  s.window.crmLastRemoteValue=s.window.crmOptimisticRemoteValue=JSON.stringify(base());
  s.window.crmPendingDbMutations=[{id:'auth-only',mutation:{changedCount:1,documents:{auth:legacy}}}];
  const replay=s.crmConsumePendingMutations(base());
  await s.window.storage.set('state',JSON.stringify(replay.state),replay.saveOptions);
  assert.equal(calls.length,0);assert.equal(s.window.crmPendingDbMutations.length,0);
});
