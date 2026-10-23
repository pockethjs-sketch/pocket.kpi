import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {contractReviewPreview} from '../src/data/contractReviewPreview.js';
import {reviewLeadId,buildContractReviewItems} from '../src/data/contractReviewMatches.js';
import {operationsFile,missingOperationsSource} from './operations-file.mjs';
const opsCode=operationsFile('Code.gs');
const row=(extra={})=>({row:2,date:'2026-10-22',amount:5500000,dealText:'예시 개발',paymentText:'V',ctype:'기존',...extra});
const item=(extra={})=>({id:'review-test',company:'가상 기존고객',sourceKey:'synthetic',sourceHash:'a'.repeat(64),firstDate:'2026-10-22',lastDate:'2026-10-22',ctype:'기존',owner:'예시 담당',sourceAmount:5500000,sourceRows:[row()],services:['AX 개발'],...extra});
const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');

test('existing-customer types, exact H marks and partial percentages use O total without receipt dates',()=>{
 const full=contractReviewPreview(item());assert.equal(full.canAdd,true);assert.equal(full.confirmedPaid,5500000);assert.equal(full.paymentNotCompared,0);
 const partial=contractReviewPreview(item({sourceRows:[row({paymentText:'50%'})]}));assert.equal(partial.confirmedPaid,2750000);
 const unknown=contractReviewPreview(item({sourceRows:[row({paymentText:'예정',paymentAmount:0})]}));assert.equal(unknown.canAdd,true);assert.equal(unknown.confirmedPaid,0);assert.equal(unknown.paymentNotCompared,1);
});
test('different contract dates, duplicated rows, ambiguous companies and invalid amounts stay held',()=>{
 for(const value of [item({sourceRows:[row(),row({row:3,date:'2026-09-01'})]}),item({sourceRows:[row(),row({row:3})]}),item({company:'가상A/가상B'}),item({sourceRows:[row({amount:0})]}),item({sourceRows:[row({paymentAmount:6000000,paymentText:'600만원'})]})])assert.equal(contractReviewPreview(value).canAdd,false);
});
test('missing-sheet button sits directly after CRM link, always opens and refreshes without auto sync',()=>{
 const crm=main.indexOf('>CRM 링크</Btn>'),button=main.indexOf('시트 미등록 확인',crm);
 assert.ok(crm>0&&button>crm&&button-crm<1000);
 assert.match(main,/setContractReviewOpen\(true\); refreshContractReview\(true, false\)/);
 assert.match(main,/const refreshContractReview = async \(showToast = false, runSync = false\)/);
 assert.match(main,/신규\/기존 모두 · 프리미팅 이력 없어도 추가 가능/);
 assert.match(main,/!contractReviewBusy && !contractReviewError && contractReviewVisible.length === 0/);
});
function harness(role='OWNER'){
 const db={leads:[],contractEvents:[],contractStatusLogs:[]},calls=[];
 const sandbox={db,contractReviewPreview,reviewLeadId,buildContractReviewItems,currentAccount:{serverRole:role},contractCompanyAliases:value=>[String(value).replace(/\s/g,'')],
 setContractApplyingId:()=>{},up:fn=>{calls.push('up');fn(db);},actualPaid:l=>(l.payments||[]).reduce((s,p)=>s+(p.paidConfirmed||p.paidAt?Number(p.amount):0),0),
 syncPaid:l=>l.paid=(l.payments||[]).reduce((s,p)=>s+(p.paidConfirmed||p.paidAt?Number(p.amount):0),0),todayISO:()=> '2026-10-22',fmtWon:v=>String(v),contractReviewActor:'예시 사용자',appendContractStatusLog:(d,l)=>d.contractStatusLogs.push(l),
 window:{crmWaitForRemoteCommit:async()=>calls.push('ack'),crmReadPrimaryContractState:async()=>{calls.push('verify');return {state:db};},crmSetContractSheetChangeStatus:async()=>calls.push('queue')},removeContractReviewItem:()=>calls.push('remove'),refreshContractReview:async(...args)=>{calls.push(['review',...args]);},toast:()=>{},Date};
 const start=main.indexOf('  const applyContractReviewItem = async');const end=main.indexOf('  const ignoreContractReviewItem',start);
 vm.createContext(sandbox);vm.runInContext(main.slice(start,end)+';globalThis.apply=applyContractReviewItem;',sandbox);
 return {db,calls,apply:sandbox.apply,sandbox};
}
test('real create handler adds an existing-type customer without premeeting/inflow dates; H100 confirms once',async()=>{
 const h=harness();await h.apply(item());const lead=h.db.leads[0];
 assert.equal(lead.ctype,'기존');assert.equal(lead.status,'계약 완료');assert.equal(lead.paid,5500000);assert.equal(lead.contractAmount,5500000);
 assert.equal(lead.createdAt,'');assert.equal(lead.premeetingAt,'');assert.equal(lead.premeetingDoneAt,'');assert.equal(lead.payments[0].paidAt,'');assert.equal(lead.payments[0].actualPaidAtUnknown,true);
 assert.deepEqual(h.calls.filter(v=>typeof v==='string'),['up','ack','verify','queue','remove']);
 await h.apply(item());assert.equal(h.db.leads.length,1);assert.equal(h.db.contractEvents.length,1);
});

test('a post-save mismatch cannot mark the review applied or announce verified creation',async()=>{
 const h=harness();h.sandbox.window.crmReadPrimaryContractState=async()=>({state:{leads:[]}});
 await h.apply(item());assert.equal(h.db.leads.length,1);assert.ok(!h.calls.includes('queue'));assert.ok(!h.calls.includes('remove'));
});
test('partial confirmation preserves total schedule; unknown H is counted, and VIEWER/ambiguous data cannot write',async()=>{
 const partial=harness();await partial.apply(item({sourceRows:[row({paymentText:'50%'})]}));const lead=partial.db.leads[0];assert.equal(lead.paid,2750000);assert.equal(lead.payments.length,2);assert.equal(lead.payments.reduce((s,p)=>s+p.amount,0),5500000);
 const unknown=harness();await unknown.apply(item({sourceRows:[row({paymentText:''})]}));assert.equal(unknown.db.leads[0].contractSheetPaymentNotCompared,1);assert.equal(unknown.db.leads[0].payments[0].paidConfirmed,false);
 const denied=harness('VIEWER');await denied.apply(item());assert.equal(denied.db.leads.length,0);
 const held=harness();await held.apply(item({sourceRows:[row(),row({row:3,date:'2026-09-01'})]}));assert.equal(held.db.leads.length,0);
});

test('approved existing-company October contract creates a separate stable contract and preserves September money/dates',async()=>{
 const h=harness();
 h.db.leads.push({id:'old-contract',company:'가상 기존고객',contractAt:'2026-09-01',contractAmount:3300000,paid:3300000,payments:[{amount:3300000,paidAt:'2026-09-10',paidConfirmed:true}],memo:'보존할 예시 메모'});
 const before=JSON.stringify(h.db.leads[0]),source={...row(),company:'가상 기존고객',paymentPercent:100,paymentAmount:0};
 const report={ok:true,schemaVersion:'contract-review-source-v1',sourceHash:'a'.repeat(64),start:'2026-08-01',rangeRows:1,rows:[source],fetchedAt:new Date().toISOString()};
 const found=await buildContractReviewItems(report,h.db);
 h.sandbox.contractReview={sourceHash:report.sourceHash,sourceCutoff:report.start,checkedAt:report.fetchedAt};
 await h.apply(found.items[0]);
 assert.equal(h.db.leads.length,2);assert.equal(JSON.stringify(h.db.leads.find(x=>x.id==='old-contract')),before);
 const created=h.db.leads.find(x=>x.id!=='old-contract');assert.equal(created.contractCompanyLeadId,'old-contract');assert.equal(created.contractAmount,5500000);assert.equal(created.paid,5500000);assert.equal(created.payments[0].paidAt,'');
 assert.ok(!h.calls.includes('queue'));assert.ok(h.calls.includes('verify'));
 await h.apply(found.items[0]);assert.equal(h.db.leads.length,2);
});

test('pending save failure cannot create an existing-company contract or discard its journal',async()=>{
 const h=harness();h.db.leads.push({id:'old',company:'가상 기존고객',contractAt:'2026-09-01',contractAmount:100});
 h.sandbox.window.crmWaitForRemoteCommit=async()=>{throw Error('remote_save_timeout');};
 const found=await buildContractReviewItems({ok:true,schemaVersion:'contract-review-source-v1',sourceHash:'a'.repeat(64),start:'2026-08-01',rangeRows:1,rows:[{...row(),company:'가상 기존고객',paymentPercent:100,paymentAmount:0}],fetchedAt:new Date().toISOString()},h.db);
 await h.apply(found.items[0]);assert.equal(h.db.leads.length,1);assert.ok(!h.calls.includes('up'));
});

test('standalone creation works with three prior contracts, stores explicit new type, and preserves all old records/source',async()=>{
 const h=harness();
 h.db.leads.push(...['2026-07-08','2026-09-07','2026-09-18'].map((contractAt,index)=>({id:'old-'+index,company:'가상 기존고객',contractAt,contractAmount:3300000,paid:3300000,payments:[{amount:3300000,paidConfirmed:true,paidAt:'2026-09-20'}],memo:'보존할 합성 메모'})));
 const old=JSON.stringify(h.db.leads),source={...row(),company:'가상 기존고객',amount:50050000,paymentPercent:50,paymentText:'50%',paymentAmount:0};
 const report={ok:true,schemaVersion:'contract-review-source-v1',sourceHash:'a'.repeat(64),start:'2026-08-01',rangeRows:1,rows:[source],fetchedAt:new Date().toISOString()};
 const found=await buildContractReviewItems(report,h.db);h.sandbox.contractReview={sourceHash:report.sourceHash,sourceCutoff:report.start,checkedAt:report.fetchedAt};
 const candidate={...found.items[0],creationMode:'standalone',customerTypeOverride:'신규',targetId:'old-0'},before=JSON.stringify(candidate.sourceRows);
 await h.apply(candidate);
 assert.equal(h.db.leads.length,4);assert.equal(JSON.stringify(h.db.leads.filter(x=>x.id.startsWith('old-'))),old);
 const created=h.db.leads.find(x=>x.id===reviewLeadId(candidate));
 assert.equal(created.ctype,'신규');assert.equal(created.contractCompanyLeadId,'');assert.equal(created.contractSheetCreationMode,'standalone');assert.equal(created.contractSheetSourceCustomerType,'기존');
 assert.equal(created.contractAmount,50050000);assert.equal(created.paid,25025000);assert.equal(created.payments.reduce((s,p)=>s+p.amount,0),50050000);assert.ok(created.payments.every(p=>p.paidAt===''));assert.equal(created.premeetingAt,'');
 assert.equal(h.db.contractEvents[0].ctype,'신규');assert.equal(h.db.contractEvents[0].sourceCustomerType,'기존');assert.equal(h.db.contractEvents[0].sourceData[0].ctype,'기존');assert.equal(JSON.stringify(candidate.sourceRows),before);
 assert.equal(h.db.contractStatusLogs.at(-1).meta.creationMode,'standalone');assert.equal(h.db.contractStatusLogs.at(-1).meta.customerType,'신규');
 await h.apply({...candidate,creationMode:'linked',targetId:'old-1'});assert.equal(h.db.leads.length,4);assert.equal(h.db.contractEvents.length,1);
});

test('standalone mode and customer classification are independent, while financial and identity holds stay enforced',async()=>{
 const target=item({contractKey:'b'.repeat(64),matchType:'new_contract',candidates:[{id:'old'}],targetId:'',creationMode:'standalone',customerTypeOverride:'기존'});
 const preview=contractReviewPreview(target);assert.equal(preview.canAdd,true);assert.equal(preview.customerType,'기존');assert.equal(preview.parentId,'');
 for(const extra of [{reviewReason:'같은 날짜의 기존 계약 충돌'},{creationMode:'invalid'},{customerTypeOverride:'VIP'},{customerTypeOverride:''},{sourceRows:[row(),row({row:3})]},{sourceRows:[row({amount:0})]},{company:'가상A/가상B'}])assert.equal(contractReviewPreview({...target,...extra}).canAdd,false);
 assert.equal(contractReviewPreview({...target,creationMode:'linked'}).canAdd,false);
 const denied=harness('VIEWER');await denied.apply(target);assert.equal(denied.db.leads.length,0);
});

test('fresh server duplicate/conflict and save-ACK failures still refuse standalone creation',async()=>{
 for(const kind of ['duplicate','conflict','ack']){
  const h=harness(),source={...row(),company:'가상 기존고객',paymentPercent:100,paymentAmount:0};
  h.db.leads.push({id:'old',company:'가상 기존고객',contractAt:'2026-09-01',contractAmount:100});
  const report={ok:true,schemaVersion:'contract-review-source-v1',sourceHash:'a'.repeat(64),start:'2026-08-01',rangeRows:1,rows:[source],fetchedAt:new Date().toISOString()};
  const found=await buildContractReviewItems(report,h.db),candidate={...found.items[0],creationMode:'standalone',customerTypeOverride:'신규'};
  h.sandbox.contractReview={sourceHash:report.sourceHash,sourceCutoff:report.start,checkedAt:report.fetchedAt};
  if(kind==='ack')h.sandbox.window.crmWaitForRemoteCommit=async()=>{throw Error('remote_save_timeout');};
  else h.sandbox.window.crmReadPrimaryContractState=async()=>({state:{leads:[{id:'fresh',company:source.company,status:'계약 완료',contractAt:source.date,contractAmount:kind==='duplicate'?source.amount:123,paid:source.amount,contractSheetContractKey:kind==='duplicate'?candidate.contractKey:undefined}]}});
  await h.apply(candidate);assert.equal(h.db.leads.length,1);assert.ok(!h.calls.includes('up'));
 }
});

test('post-save classification or parent mismatch cannot announce successful standalone creation',async()=>{
 for(const field of ['ctype','contractCompanyLeadId','contractSheetCreationMode','contractSheetSourceCustomerType']){
  const h=harness(),source={...row(),company:'가상 기존고객',paymentPercent:100,paymentAmount:0};
  const report={ok:true,schemaVersion:'contract-review-source-v1',sourceHash:'a'.repeat(64),start:'2026-08-01',rangeRows:1,rows:[source],fetchedAt:new Date().toISOString()};
  const candidate={...(await buildContractReviewItems(report,h.db)).items[0],creationMode:'standalone',customerTypeOverride:'신규'};
  h.sandbox.contractReview={sourceHash:report.sourceHash,sourceCutoff:report.start,checkedAt:report.fetchedAt};
  h.sandbox.window.crmReadPrimaryContractState=async()=>({state:{leads:h.db.leads.map(x=>({...x,[field]:'mismatch'}))}});
  await h.apply(candidate);assert.equal(h.db.leads.length,1);assert.ok(!h.calls.includes('remove'));
 }
});

test('existing review backend includes existing-type and no-meeting source customers, excluding actual DB duplicates',{skip:opsCode==null?missingOperationsSource:false},()=>{
 const normalize=s=>String(s).replace(/\s/g,'').toLowerCase();
 const group=(name,type)=>({changeId:'synthetic-'+type,sourceKey:normalize(name),sourceHash:type,company:name,aliases:[normalize(name)],rows:[row()],amount:5500000,numericPaid:0,ctype:type,firstDate:'2026-10-22',lastDate:'2026-10-22',services:['AX 개발']});
 let state={leads:[]};let ledgerWrites=0;
 const s={_crmContractSourceGroups:()=>[group('가상 기존','기존'),group('가상 신규','신규')],_crmReadSupabasePrimaryEnvelope_:()=>({data:JSON.stringify(state)}),_crmContractAliases:v=>[normalize(v)],_crmContractQueueMap:()=>({}),_crmContractAppliedSourceMap:()=>({keys:{},hashes:{}}),_crmContractQueueHeaders:()=>[],_crmIso:()=> '2026-10-22T02:00:00Z',CONTRACT_SYNC_QUEUE_SHEET:'synthetic',CONTRACT_SOURCE_SHEET:'synthetic',CONTRACT_SOURCE_CUTOFF:'2026-08-01',CONTRACT_SOURCE_SPREADSHEET_ID:'synthetic',_crmUpsertLedgerRows:()=>ledgerWrites++};
 const start=opsCode.indexOf('function _crmReadContractSheetChanges()'),end=opsCode.indexOf('function _crmSetContractChangeStatus',start);
 vm.createContext(s);vm.runInContext(opsCode.slice(start,end),s);
 const result=s._crmReadContractSheetChanges();assert.equal(result.pending,2);assert.ok(result.items.some(r=>r.ctype==='기존'));assert.ok(result.items.some(r=>r.ctype==='신규'));assert.equal(ledgerWrites,1);
 state={leads:[{id:'existing',company:'가상 기존',status:'신규 DB'}]};assert.equal(s._crmReadContractSheetChanges().pending,1);
});
