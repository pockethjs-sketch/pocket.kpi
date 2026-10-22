import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {contractReviewPreview} from '../src/data/contractReviewPreview.js';
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
 const sandbox={db,contractReviewPreview,currentAccount:{serverRole:role},contractCompanyAliases:value=>[String(value).replace(/\s/g,'')],
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
