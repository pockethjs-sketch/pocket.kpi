import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import{readFileSync}from'node:fs';
import{prepareSheetContract,handleSheetContractCreate}from'../supabase/functions/_shared/sheet-contract-create.mjs';
import{buildContractReviewItems}from'../src/data/contractReviewMatches.js';
import{boundedContractOperation,quarantineContractJournal,verifyCreatedContract,contractCreateError}from'../src/data/contractCreate.js';
const makeReport=(extra={})=>({ok:true,schemaVersion:'contract-review-source-v1',sourceHash:'a'.repeat(64),start:'2026-08-01',end:'2026-11-17',fetchedAt:new Date().toISOString(),rangeRows:1,rows:[{row:9,company:'합성 계약회사',date:'2026-11-17',dealText:'합성 프로젝트',amount:1100000,paymentPercent:50,paymentAmount:0,paymentText:'50%',actualPaidAt:'2026-11-17',ctype:'기존',service:'개발',owner:'',...extra}]});
async function approval(report=makeReport(),state={leads:[]}){const candidate=(await buildContractReviewItems(report,state)).items[0];return {contractKey:candidate.contractKey,sourceHash:candidate.sourceHash,reportSourceHash:report.sourceHash,creationMode:'standalone',customerType:'기존',parentId:''};}
test('source-approved partial/full/undated/unknown payments preserve amount/check/date semantics',async()=>{
 for(const [percent,at]of[[50,'2026-11-17'],[100,''],[null,'']]){
  const report=makeReport({paymentPercent:percent,paymentText:percent===null?'':percent+'%',actualPaidAt:at}),request=await approval(report);
  const result=await prepareSheetContract(report,{leads:[]},request,'synthetic');
  const paid=percent===null?0:Math.round(1100000*percent/100);
  assert.equal(result.lead.paid,paid);assert.equal(result.lead.createdAt,'');assert.equal(result.lead.premeetingAt,'');
  assert.equal(result.lead.payments.reduce((s,p)=>s+p.amount,0),1100000);
  assert.equal(result.lead.payments.filter(p=>p.paidConfirmed).length,paid>0?1:0);
  if(paid)assert.equal(result.lead.payments[0].paidAt,at);
  if(paid&&!at)assert.equal(result.lead.payments[0].actualPaidAtUnknown,true);
 }
});
test('fresh source/hash/duplicate/parent/archived holds are not bypassed',async()=>{
 const report=makeReport(),request=await approval(report);
 await assert.rejects(prepareSheetContract({...report,sourceHash:'b'.repeat(64)},{leads:[]},request,'synthetic'),/source_changed/);
 await assert.rejects(prepareSheetContract({...report,rows:[...report.rows,...report.rows],rangeRows:2},{leads:[]},request,'synthetic'),/source_held/);
 await assert.rejects(prepareSheetContract(report,{leads:[]},{...request,creationMode:'linked',parentId:'missing'},'synthetic'),/source_held/);
 await assert.rejects(prepareSheetContract(report,{leads:[{id:'archived',contractSheetContractKey:request.contractKey,archivedAt:'2026-10-01'}]},request,'synthetic'),/already_exists/);
});
test('service handler commits only a canonical prepared row, not caller money or caller identity',async()=>{
 const report=makeReport(),request=await approval(report);let sent;
 const client={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{primary_revision:'synthetic',state_snapshot:{leads:[]}}})})})}),rpc:async(name,args)=>{sent={name,args};return{data:{ok:true,verified:true},error:null};}};
 const result=await handleSheetContractCreate({...request,paid:99,actor:'forged'},client,'synthetic-org','verified-actor',{readSource:async()=>report});
 assert.equal(result.status,200);assert.equal(sent.name,'kpi_create_sheet_contract');assert.equal(sent.args.p_lead.paid,550000);assert.equal(sent.args.p_log.actor,'verified-actor');
});
test('bounded operations and real wait loop terminate even when the save queue never settles',async()=>{
 await assert.rejects(boundedContractOperation(new Promise(()=>{}),10),/contract_operation_timeout/);
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 const code=main.slice(main.indexOf('  window.crmWaitForRemoteCommit ='),main.indexOf('  function crmFetchSheetAction'));
 const context={window:{crmSaveQueue:new Promise(()=>{}),crmPendingRemoteSaves:1},Date,crmDelay:async()=>{},boundedContractOperation,localStorage:{getItem:()=> '1'},CRM_LOCAL_DIRTY_KEY:'synthetic'};
 vm.createContext(context);vm.runInContext(code,context);
 await assert.rejects(context.window.crmWaitForRemoteCommit(15),/remote_save_timeout/);
});
test('overlapping stale journals are preserved but quarantined; unrelated entries remain replayable',()=>{
 const entries=[{id:'overlap',mutation:{changedCount:1,collections:{leads:{upsert:[{id:'new',paid:1}]}}}},{id:'unrelated',mutation:{changedCount:1,collections:{leads:{patches:[{id:'old',ops:[]}]}}}}];
 const before=JSON.stringify(entries),result=quarantineContractJournal(entries,'new');
 assert.equal(JSON.stringify(entries),before);assert.equal(result.length,2);assert.equal(result[0].blockedByConfirmedContract,'new');assert.equal(result[1].blockedByConfirmedContract,undefined);
 assert.deepEqual(result[0].mutation,entries[0].mutation);
});
test('post-save disagreement and refresh failure are persistent errors, not success or automatic write retries',async()=>{
 const report=makeReport(),request=await approval(report),prepared=await prepareSheetContract(report,{leads:[]},request,'synthetic');
 const expected={...request,contractAmount:1100000,confirmedPaid:550000,sourceCustomerType:prepared.lead.contractSheetSourceCustomerType};
 assert.equal(verifyCreatedContract({ok:true,verified:true,leadId:prepared.lead.id},{leads:[prepared.lead]},expected),prepared.lead);
 assert.throws(()=>verifyCreatedContract({ok:true,verified:true,leadId:prepared.lead.id},{leads:[{...prepared.lead,paid:0}]},expected),/verification_failed/);
 assert.throws(()=>verifyCreatedContract({ok:true,verified:true,leadId:prepared.lead.id},{leads:[prepared.lead]},{...expected,actualPaidAt:''}),/verification_failed/);
 assert.throws(()=>verifyCreatedContract({ok:true,verified:true,leadId:prepared.lead.id},{leads:[{...prepared.lead,payments:prepared.lead.payments.map(p=>({...p,paidConfirmed:false}))}]},expected),/verification_failed/);
 assert.match(contractCreateError('contract_created_refresh_failed'),/서버 저장은 완료.*다시 생성하지 말고/);
 const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');assert.match(source,/contractCreateFailure && <p role="alert"/);
});
test('scoped creation keeps the existing employee write and page-scope gates',async()=>{
 const {canEmployeeAct}=await import('../supabase/functions/_shared/employee-access.mjs');
 const {canAccessAction}=await import('../supabase/functions/_shared/premeeting-access.mjs');
 assert.equal(canEmployeeAct({ok:true,role:'VIEWER'},'write'),false);
 assert.equal(canEmployeeAct({ok:true,role:'EDITOR'},'write'),true);
 assert.equal(canAccessAction({scope:'premeeting'},'sheet_contract_create'),false);
 assert.equal(canAccessAction({scope:'all'},'sheet_contract_create'),true);
 const source=readFileSync(new URL('../supabase/functions/kpi-domain-api/index.ts',import.meta.url),'utf8');
 assert.ok(source.indexOf('if (!canEmployeeAct(access, permission)')<source.indexOf("if (action === 'sheet_contract_create')"));
 assert.ok(source.indexOf('if (!canAccessAction(access, action, body))')<source.indexOf("if (action === 'sheet_contract_create')"));
 const migration=readFileSync(new URL('../supabase/migrations/20261117011321_scoped_sheet_contract_invoker_dates.sql',import.meta.url),'utf8');
 assert.doesNotMatch(migration,/private\.kpi_try_date/);
 assert.match(migration,/security invoker/i);
 assert.doesNotMatch(migration,/grant usage|security definer/i);
});
