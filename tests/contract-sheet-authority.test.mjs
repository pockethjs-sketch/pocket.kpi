import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {_crmParseContractSource as parse, _crmPlanContractAndPaymentSync as plan} from '../scripts/contract-sheet-sync-core.mjs';
import {syncPaymentScheduleTotal} from '../src/data/paymentSchedule.js';
import {syncChanges, formatSyncValue} from '../src/data/syncActivity.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const now='2026-09-30T02:00:00Z';
const source=(h='V',price='500')=>parse([['날짜','업체명','프리','프로젝트','별도가','비고','신규/기존','대금 지급 확인'],['26-09-28','합성기업','','투A',price,'','신규',h]],hash,'2026-08-01');
const base=()=>({id:'synthetic',company:'합성기업',ctype:'신규',status:'계약 완료',premeetingAt:'2026-09-20',contractAt:'2026-09-28',contractAmount:4400000,paid:0,payments:[{id:'p1',no:1,label:'일시금',amount:4400000,paidAt:'',dueAt:'2026-10-01',memo:'보존'}]});
function run(l,h='V',price='500') {
  const result=plan(source(h,price),{leads:[l]},now,hash),next=structuredClone(l);
  for(const patch of result.mutation.collections.leads.patches)for(const op of patch.ops)next[op.path[0]]=structuredClone(op.value);
  return {result,next};
}
test('O updates mismatched total and schedule atomically, H V confirms full payment; reload is stable',()=>{
  const original=base(),{result,next}=run(original);
  assert.equal(result.updated.length,1);assert.equal(result.paymentUpdated.length,1);
  assert.equal(result.mutation.collections.leads.patches.length,1);
  assert.equal(next.contractAmount,5500000);assert.equal(next.payments[0].amount,5500000);
  assert.equal(next.paid,5500000);assert.equal(next.payments[0].paidConfirmed,true);
  assert.equal(next.payments[0].paidAt,'');assert.equal(next.payments[0].memo,'보존');
  assert.equal(next.payments[0].dueAt,'2026-10-01');
  syncPaymentScheduleTotal(next);assert.equal(next.contractAmount,5500000);
  assert.equal(run(next).result.mutation.collections.leads.patches.length,0);
  assert.equal(original.contractAmount,4400000);
  const log=result.mutation.collections.contractStatusLogs.upsert.find(x=>x.meta.policy);
  assert.deepEqual(syncChanges(log).map(x=>x.key),['contractAmount','paymentScheduleTotal']);
  assert.equal(formatSyncValue('paymentScheduleTotal',5500000),'5,500,000원');
});
test('H 50% uses the corrected O amount, not the old web total',()=>{
  const {next}=run(base(),'50%');assert.equal(next.paid,2750000);
  assert.deepEqual(next.payments.map(x=>x.amount),[2750000,2750000]);
  assert.deepEqual(next.payments.map(x=>!!x.paidConfirmed),[true,false]);
  assert.equal(run(next,'50%').result.mutation.collections.leads.patches.length,0);
});
test('already received money and its date are preserved; only the increase becomes another confirmed receipt',()=>{
  const l=base();l.payments[0].paidAt='2026-09-29';l.paid=4400000;
  const {next}=run(l);assert.deepEqual(next.payments[0],l.payments[0]);
  assert.equal(next.payments[1].amount,1100000);assert.equal(next.payments[1].paidConfirmed,true);
  assert.equal(next.payments[1].paidAt,'');assert.equal(next.paid,5500000);
});
test('O alone changes total and unpaid proportions but does not manufacture receipts',()=>{
  const l=base();l.payments=[{id:'a',amount:1100000,label:'선금',memo:'a'},{id:'b',amount:3300000,label:'잔금',memo:'b'}];
  const {next,result}=run(l,'');assert.equal(result.paymentUpdated.length,0);
  assert.deepEqual(next.payments.map(p=>p.amount),[1375000,4125000]);
  assert.equal(next.paid,0);assert.ok(next.payments.every(p=>!p.paidConfirmed));
});
test('source price corrections after partial receipt keep actual received amount and recompute remaining balance',()=>{
  const a=run(base(),'50%').next;
  const {next}=run(a,'50%','600');
  assert.equal(next.contractAmount,6600000);assert.equal(next.paid,3300000);
  assert.equal(next.payments.reduce((s,p)=>s+p.amount,0),6600000);
  assert.equal(run(next,'50%','600').result.mutation.collections.leads.patches.length,0);
});
test('old same-source contract sync hash cannot skip schedule reconciliation',()=>{
  const l=base(),g=source()[0];l.contractSheetSync={sourceKey:g.sourceKey,syncHash:g.syncHash,applied:{contractAmount:5500000}};
  const {next}=run(l);assert.equal(next.contractAmount,5500000);assert.equal(next.payments[0].paidConfirmed,true);
});
test('O never refunds existing receipts or silently deletes their schedules',()=>{
  const l=base();l.paid=4400000;l.payments[0].paidAt='2026-09-28';
  const {result,next}=run(l,'V','300');assert.equal(result.mutation.collections.leads.patches.length,0);
  assert.ok(result.blocked.length);assert.deepEqual(next,l);
});
test('H percentage spanning multiple installments confirms exactly that cumulative amount',()=>{
  const l=base();l.payments=[{id:'a',no:1,label:'선금',amount:1320000},{id:'b',no:2,label:'중도금',amount:1760000,memo:'중도금 보존'},{id:'c',no:3,label:'잔금',amount:1320000}];
  const {next}=run(l,'50%');assert.equal(next.paid,2750000);
  assert.equal(next.payments.reduce((s,p)=>s+p.amount,0),5500000);
  assert.equal(next.payments.filter(p=>p.paidConfirmed).reduce((s,p)=>s+p.amount,0),2750000);
  assert.equal(next.payments.find(p=>p.id==='b').memo,'중도금 보존');
  assert.equal(run(next,'50%').result.mutation.collections.leads.patches.length,0);
});
test('ambiguous source groups, future dates and CRM-owned schedules remain untouched',()=>{
  const l=base();l.payments[0].crmManaged=true;
  assert.equal(run(l).result.mutation.collections.leads.patches.length,0);
  const groups=source();groups.push(structuredClone(groups[0]));
  assert.equal(plan(groups,{leads:[base()]},now,hash).mutation.collections.leads.patches.length,0);
  const future=source();future[0].lastDate=future[0].rows[0].date='2026-10-01';
  assert.equal(plan(future,{leads:[base()]},now,hash).mutation.collections.leads.patches.length,0);
});
