import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { _crmParseContractSource as parse, _crmPlanContractAutoSync as plan, _crmPlanContractPaymentSync as paymentPlan, _crmPlanContractAndPaymentSync as combinedPlan, _crmSyncMoney as money } from '../scripts/contract-sheet-sync-core.mjs';
const hash = s => createHash('sha256').update(s).digest('hex');
const header = ['날짜','업체명','프리','프로젝트','별도가','비고','신규/기존','대금 지급 확인'];
const now = '2026-09-15T10:00:00.000Z';
const source = (rows = [['26-09-07','Tellus(텔어스)','이이사님','자금유치AA(V1)','686.4','IR 보완/선잔금','신규','✔']]) => parse([header,...rows],hash,'2026-08-01');
const lead = (extra = {}) => ({id:'one',company:'Tellus',ctype:'신규',status:'프리미팅 완료',premeetingAt:'2026-07-30',contractAmount:0,contractAt:'',memo:'직접 입력한 메모',payments:[{id:'p1',amount:100,paidAt:'2026-09-01'}],paid:100,history:[{note:'사용자 이력'}],...extra});
const apply = (state, result) => {
  const next=structuredClone(state);
  for(const p of result.mutation.collections.leads.patches) for(const op of p.ops) next.leads.find(l=>l.id===p.id)[op.path[0]]=structuredClone(op.value);
  next.contractStatusLogs=[...(next.contractStatusLogs||[]),...result.mutation.collections.contractStatusLogs.upsert];
  return next;
};
test('deployed Apps Script core matches the tested source',()=>{
  const code=readFileSync(new URL('../../pocket-kpi-deploy/Code.gs',import.meta.url),'utf8');
  const core=readFileSync(new URL('../scripts/contract-sheet-sync-core.mjs',import.meta.url),'utf8').replace(/^export /gm,'').replace(/\r/g,'').trim();
  assert.equal(code.split('/* BEGIN GENERATED CONTRACT SYNC CORE */')[1].split('/* END GENERATED CONTRACT SYNC CORE */')[0].replace(/\r/g,'').trim(),core);
  new vm.Script(code);
});
test('header names, separate price, VAT and explicit included price',()=>{
  assert.equal(source()[0].amount,7550400);
  assert.equal(source()[0].ctype,'신규');
  assert.equal(source()[0].rows[0].memo,'IR 보완/선잔금');
  assert.equal(money('500').amount,5500000);
  assert.equal(money('500(포함가)').amount,5000000);
  assert.equal(money('5,000,000원').amount,5500000);
  for(const v of ['', 'V2','500+200','-100','500/월','조율 중']) assert.equal(money(v).amount,null);
});
test('missing or duplicate source headers fail closed instead of returning zero',()=>{
  assert.throws(()=>parse([header.filter(h=>h!=='신규/기존')],hash,'2026-08-01'),/contract_source_header/);
  assert.throws(()=>parse([[...header,'별도가']],hash,'2026-08-01'),/contract_source_header/);
  const reordered=[...header].reverse();
  const r=['26-09-01','기업','이이사님','투A(V2)','500','','신규',''];
  assert.equal(parse([reordered,r.reverse()],hash,'2026-08-01')[0].amount,5500000);
});
test('does not inherit another company type, owner or date',()=>{
  const g=source([['26-09-01','기업A','이이사님','투A','500','','신규'],['26-09-02','기업B','','투A','400','','']]);
  assert.equal(g[1].ctype,'');assert.equal(g[1].owner,'');
  assert.equal(source([['26-09-31','기업A','','투A','500','','신규']]).length,0);
});
test('only unique premeeting match; normal CRM duplicate is not another premeeting',()=>{
  const state={leads:[lead(),lead({id:'inquiry',status:'신규 DB',premeetingAt:''})]};
  const result=plan(source(),state,now,hash);assert.equal(result.updated.length,1);
  const next=apply(state,result);
  assert.equal(next.leads[0].contractAmount,7550400);assert.equal(next.leads[0].contractAt,'2026-09-07');
  assert.equal(next.leads[0].status,'계약 완료');
  assert.ok(next.leads[0].memo.startsWith('직접 입력한 메모'));
  assert.match(next.leads[0].memo,/IR 보완/);
  assert.deepEqual(next.leads[0].payments,state.leads[0].payments);
  assert.deepEqual(next.leads[0].history,state.leads[0].history);
  assert.equal(next.leads[0].paid,state.leads[0].paid);
  assert.deepEqual(next.leads[1],state.leads[1]);
  assert.equal(next.contractStatusLogs[0].meta.before.contractAmount,0);
  assert.equal(next.contractStatusLogs[0].meta.after.contractAmount,7550400);
});
test('repeat refresh is a no-op, including row shifts and payment checks',()=>{
  const state={leads:[lead()]};const s=source();const next=apply(state,plan(s,state,now,hash));
  const changed=[...s[0].rows];changed[0]={...changed[0],row:999,paymentChecked:false};
  const again=plan([{...s[0],rows:changed}],next,now,hash);
  assert.equal(again.updated.length,0);assert.equal(again.unchanged,1);
  assert.equal(again.mutation.collections.contractStatusLogs.upsert.length,0);
});
test('existing manual money and dates are not replaced, nor are later manual overrides',()=>{
  for(const extra of [{contractAmount:5000000},{contractAt:'2026-09-03'},{ctype:'기존'}]) assert.equal(plan(source(),{leads:[lead(extra)]},now,hash).updated.length,0);
  const s=source();const state={leads:[lead()]};const next=apply(state,plan(s,state,now,hash));
  next.leads[0].contractAmount=9000000;
  const s2=source([['26-09-07','Tellus(텔어스)','','자금유치AA(V1)','700','수정 내용','신규']]);
  assert.equal(plan(s2,next,now,hash).updated.length,0);
  assert.equal(plan(s,next,now,hash).updated.length,0);
});
test('source edits update only last-auto-managed values and keep user notes',()=>{
  const state={leads:[lead()]};const next=apply(state,plan(source(),state,now,hash));
  next.leads[0].memo+='\n새 사용자 메모';
  const s=source([['26-09-07','Tellus(텔어스)','','자금유치AA(V1)','700','최신 비고','신규']]);
  const result=plan(s,next,now,hash);assert.equal(result.updated.length,1);
  const last=apply(next,result).leads[0];assert.equal(last.contractAmount,7700000);
  assert.match(last.memo,/새 사용자 메모/);assert.match(last.memo,/최신 비고/);
  assert.equal(last.memo.split('[계약 프로세스 자동연동]').length,2);
});
test('ambiguous names, compound names, aliases shared by source groups, no meeting are held',()=>{
  assert.equal(plan(source(),{leads:[lead(),lead({id:'two'})]},now,hash).updated.length,0);
  assert.equal(plan(source([['26-09-07','Tellus/다른기업','','투A','500','','신규']]),{leads:[lead()]},now,hash).updated.length,0);
  const groups=source([['26-09-07','Tellus(텔어스)','','투A','500','','신규'],['26-09-07','텔어스','','투B','200','','신규']]);
  assert.equal(plan(groups,{leads:[lead({company:'Tellus(텔어스)'})]},now,hash).updated.length,0);
  assert.equal(plan(source(),{leads:[lead({premeetingAt:''})]},now,hash).updated.length,0);
  assert.equal(plan(source(),{leads:[lead({status:'드랍'})]},now,hash).updated.length,0);
});
test('mixed type, multiple dates, incomplete price, recurring/add-on contracts do not auto apply',()=>{
  for(const row of [ ['26-09-07','Tellus','','투A','500','','기존'],['26-09-07','Tellus','','투A','','','신규'],['26-09-07','Tellus','','투A','500','추가 계약','신규'],['26-09-16','Tellus','','투A','500','','신규'] ]) {
    assert.equal(plan(source([row]),{leads:[lead()]},now,hash).updated.length,0);
  }
  const g=source([['26-08-07','Tellus','','투A','500','','신규'],['26-09-07','Tellus','','투B','200','','신규']]);
  assert.equal(plan(g,{leads:[lead()]},now,hash).updated.length,0);
});
test('source deletion is not propagated to customer or contracts',()=>{
  const s=source([['26-09-07','Tellus','','투A','500','','신규'],['26-09-07','','','투B','200','','신규']]);
  const state={leads:[lead()]};const next=apply(state,plan(s,state,now,hash));
  const short=source([['26-09-07','Tellus','','투A','500','','신규']]);
  assert.equal(plan(short,next,now,hash).updated.length,0);
  assert.equal(plan([],next,now,hash).updated.length,0);
});
test('Apps Script replans after revision conflict instead of replaying old money patch',()=>{
  const code=readFileSync(new URL('../../pocket-kpi-deploy/Code.gs',import.meta.url),'utf8');
  const start=code.indexOf('function _crmAutoSyncNewContracts(body)');
  const end=code.indexOf('\nfunction doPost',start);
  let read=0,save=0;
  const sandbox={_crmContractSourceGroups:()=>source(),_crmReadSupabasePrimaryEnvelope_:()=>({revision:'r'+(++read),data:JSON.stringify({leads:[lead(read>1?{contractAmount:999}: {})]})}),
    _crmPlanContractAndPaymentSync:combinedPlan,_crmIso:()=>now,_crmHash:hash,_crmSaveMutationV2:()=>{save++;return {error:'revision_conflict'};}};
  vm.createContext(sandbox);vm.runInContext(code.slice(start,end),sandbox);
  const r=sandbox._crmAutoSyncNewContracts({});assert.equal(save,1);assert.equal(read,2);assert.equal(r.updated.length,0);assert.equal(r.blocked.length,1);
});
test('Apps Script dry-run never writes and failure never claims success',()=>{
  const code=readFileSync(new URL('../../pocket-kpi-deploy/Code.gs',import.meta.url),'utf8');
  const body=code.slice(code.indexOf('function _crmAutoSyncNewContracts(body)'),code.indexOf('\nfunction doPost'));
  let saves=0;
  const sandbox={_crmContractSourceGroups:()=>source(),_crmReadSupabasePrimaryEnvelope_:()=>({revision:'r',data:JSON.stringify({leads:[lead()]})}),_crmPlanContractAndPaymentSync:combinedPlan,_crmIso:()=>now,_crmHash:hash,
    _crmSaveMutationV2:()=>{saves++;return {error:'primary_unavailable'};}};
  vm.createContext(sandbox);vm.runInContext(body,sandbox);
  assert.equal(sandbox._crmAutoSyncNewContracts({dryRun:true}).proposed.length,1);assert.equal(saves,0);
  assert.equal(sandbox._crmAutoSyncNewContracts({}).error,'primary_unavailable');
});
test('frontend waits for server commit and reload before announcing automatic updates',async()=>{
  const code=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
  const start=code.indexOf('const refreshContractReview = async');
  const end=code.indexOf('  useEffect(() => {',start);
  const calls=[];
  const sandbox={window:{crmRemoteApplied:true,crmRemoteLoaded:true,crmSyncInProgress:false,crmRemoteRevision:'old',
    crmWaitForRemoteCommit:async()=>calls.push('wait'),crmSyncNewContracts:async()=>{calls.push('commit');return {action:'contract_auto_sync',updated:[{}],blocked:[],revision:'new'};},
    crmReloadAfterContractSync:async()=>calls.push('reload'),crmFetchContractSheetChanges:async()=>{calls.push('review');return {pending:0};}},
    contractReviewRunning:{current:false},setContractReviewBusy:()=>{},setContractAutoSync:()=>calls.push('success'),setContractReview:()=>{},setContractReviewError:()=>{},toast:()=>{},Date};
  vm.createContext(sandbox);vm.runInContext(code.slice(start,end)+'\nglobalThis.refresh=refreshContractReview;',sandbox);
  await sandbox.refresh(true);
  assert.deepEqual(calls,['wait','commit','reload','success','review']);
  calls.length=0;sandbox.window.crmSyncNewContracts=async()=>{throw Error('network');};await sandbox.refresh(true);
  assert.deepEqual(calls,['wait']);assert.equal(sandbox.contractReviewRunning.current,false);
  calls.length=0;sandbox.window.crmRemoteLoaded=false;await sandbox.refresh(true);assert.equal(calls.length,0);
});
test('same-day duplicate source rows are never double counted',()=>{
  const row=['26-09-07','Tellus','','투A','500','','신규'];
  assert.equal(plan(source([row,row]),{leads:[lead()]},now,hash).updated.length,0);
});

test('H checkbox confirms only exact unpaid single installment without inventing payment date',()=>{
  const g=source([['26-09-07','Tellus','','투A','500','','신규','✔']]);
  const original=lead({status:'계약 완료',contractAmount:5500000,contractAt:'2026-09-07',payments:[{id:'p1',amount:5500000,paidAt:'',memo:'사용자 메모'}],paid:0});
  const state={leads:[original]};const result=paymentPlan(g,state,now,hash);
  assert.equal(result.updated.length,1);assert.equal(result.blocked.length,0);
  const next=apply(state,result).leads[0];assert.equal(next.paid,5500000);
  assert.equal(next.payments[0].paidAt,'');assert.equal(next.payments[0].paidConfirmed,true);
  assert.equal(next.payments[0].memo,'사용자 메모');assert.equal(next.contractAmount,5500000);
  assert.equal(original.paid,0);assert.equal(original.payments[0].paidConfirmed,undefined);
  assert.equal(next.contractSheetPaymentSync.actualPaidAt,null);
  assert.equal(paymentPlan(g,{leads:[next]},now,hash).updated.length,0);
});
test('payment changes in H do not unconfirm or duplicate, partial and mismatched data are held',()=>{
  const g=source([['26-09-07','Tellus','','투A','500','','신규','✔']]);
  const base=lead({status:'계약 완료',contractAmount:5500000,payments:[{id:'p1',amount:5500000,paidAt:''}],paid:0});
  for(const changed of [
    {contractAmount:5000000},
    {payments:[{id:'p1',amount:2500000,paidAt:'2026-09-08'},{id:'p2',amount:3000000,paidAt:''}],paid:2500000},
    {payments:[{id:'p1',amount:5500000,paidAt:'',crmManaged:true}]},
    {status:'프리미팅 완료'},
  ]) {const r=paymentPlan(g,{leads:[{...base,...changed}]},now,hash);assert.equal(r.updated.length,0);assert.equal(r.blocked.length,1);}
  const multiple=source([['26-09-07','Tellus','','투A','500','','신규','✔'],['26-09-07','','','투B','200','','신규','']]);
  assert.equal(paymentPlan(multiple,{leads:[{...base,contractAmount:7700000}]},now,hash).updated.length,0);
  const already=apply({leads:[base]},paymentPlan(g,{leads:[base]},now,hash));
  assert.equal(paymentPlan(source([['26-09-07','Tellus','','투A','500','','신규','']]),already,now,hash).updated.length,0);
  assert.equal(paymentPlan(g,already,now,hash).unchanged,1);
});
test('same request may apply contract and its matched payment atomically',()=>{
  const g=source([['26-09-07','Tellus','','투A','500','','신규','✔']]);
  const original=lead({payments:[{id:'p1',amount:5500000,paidAt:''}],paid:0});
  const r=combinedPlan(g,{leads:[original]},now,hash);
  assert.equal(r.updated.length,1);assert.equal(r.paymentUpdated.length,1);
  assert.equal(r.mutation.collections.leads.patches.length,1);
  const next=apply({leads:[original]},r);
  assert.equal(next.leads[0].contractAmount,5500000);assert.equal(next.leads[0].payments[0].paidConfirmed,true);
  assert.equal(next.contractStatusLogs.length,2);
});

function reloadHarness() {
  const code=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
  const before={leads:[lead()],contractStatusLogs:[],adSpend:{month:10}};
  const remote=apply(before,plan(source(),before,now,hash));
  const local=structuredClone(before);local.leads[0].grade='상';local.adSpend.month=20;
  const s={window:{crmLastRemoteValue:JSON.stringify(before),crmWaitForRemoteCommit:async()=>{},
    crmReadPrimaryContractState:async()=>({state:structuredClone(remote),revision:'new'}),storage:{set:async(k,v)=>{s.saved=JSON.parse(v);return {ok:true};}}},
    latestDbRef:{current:local},timer:{current:null},skip:{current:false},localStorage:{setItem:()=>{}},
    CRM_REMOTE_REVISION_KEY:'rev',KEY3:'db',clearTimeout:()=>{},setDb:d=>{s.rendered=d;},setSaveState:t=>{s.status=t;}};
  vm.createContext(s);
  vm.runInContext(code.slice(code.indexOf('  var CRM_COLLECTION_ID_FIELDS ='),code.indexOf('  function crmSubmitMutationV3')),s);
  const start=code.indexOf('    const refresh = async () =>',code.indexOf('function useDB()'));
  vm.runInContext(code.slice(start,code.indexOf('    window.crmReloadAfterContractSync = refresh;',start))+'globalThis.refresh=refresh;',s);
  return {s,before,remote};
}
test('contract reload preserves concurrent local edits, payments and independent marketing',async()=>{
  const {s}=reloadHarness();await s.refresh();
  assert.equal(s.rendered.leads[0].contractAmount,7550400);
  assert.equal(s.rendered.leads[0].grade,'상');assert.equal(s.rendered.adSpend.month,20);
  assert.equal(JSON.stringify(s.rendered.leads[0].payments),JSON.stringify(lead().payments));
  assert.equal(s.rendered.contractStatusLogs.length,1);
  assert.equal(s.saved.leads[0].grade,'상');assert.match(s.status,/저장 확인/);
});
test('contract reload retries baseline races and does not acknowledge pending saves',async()=>{
  const {s,before,remote}=reloadHarness();let reads=0;
  s.window.crmReadPrimaryContractState=async()=>{
    if(++reads===1)s.window.crmLastRemoteValue=JSON.stringify({...before,extra:'concurrent commit'});
    return {state:structuredClone(remote),revision:'new'};
  };
  s.window.storage.set=async()=>({ok:false,pending:true});
  await assert.rejects(s.refresh(),/contract_sync_local_edits_pending/);
  assert.equal(reads,2);assert.equal(s.status,undefined);
  assert.equal(s.latestDbRef.current.leads[0].grade,'상');
});
