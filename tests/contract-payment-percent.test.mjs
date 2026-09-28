import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {_crmParseContractSource as parse, _crmPlanContractPaymentSync as plan, _crmSyncPaymentPercent as percent} from '../scripts/contract-sheet-sync-core.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const now='2026-09-28T01:00:00Z';
const source=(h)=>parse([['날짜','업체명','프리','프로젝트','별도가','비고','신규/기존','대금 지급 확인'],['26-09-18','가상기업','','투A','500','','신규',h]],hash,'2026-08-01');
const lead=(extra={})=>({id:'synthetic',company:'가상기업',status:'프리미팅 완료',premeetingAt:'2026-09-17',contractAmount:0,expected:5500000,paid:0,payments:[{id:'p1',no:1,label:'일시금',amount:5500000,paidAt:'',dueAt:'2026-10-01',memo:'보존'}],...extra});
const run=(l,h)=>{const r=plan(source(h),{leads:[l]},now,hash);const next=structuredClone(l);for(const p of r.mutation.collections.leads.patches)for(const op of p.ops)next[op.path[0]]=structuredClone(op.value);return {r,next};};
test('H accepts exact checkmarks, checkbox values and bounded displayed percentages',()=>{
  for(const h of ['V','v','✓','✔','✔️','☑','✅',true,'TRUE','입금 완료','지급완료'])assert.equal(percent(h),100);
  for(const [h,v] of [['50%',50],['33.3 %',33.3],['100％',100],['0%',0]])assert.equal(percent(h),v);
  for(const h of ['',false,'FALSE','50',0.5,'101%','-5%','50% 예정','✔ 취소','미입금 완료','V2'])assert.equal(percent(h),null);
});
test('premeeting with matched schedule can confirm full payment without changing sales stage',()=>{
  const original=lead(),{r,next}=run(original,'V');assert.equal(r.updated.length,1);
  assert.equal(next.paid,5500000);assert.equal(next.payments[0].paidConfirmed,true);
  assert.equal(next.payments[0].paidAt,'');assert.equal(next.status,original.status);
  assert.equal(next.contractAmount,0);assert.equal(next.payments[0].memo,'보존');
  assert.equal(original.paid,0);assert.equal(run(next,'✔').r.unchanged,1);
});
test('partial payment splits a single installment and preserves total, dates, notes and unpaid balance',()=>{
  const {r,next}=run(lead(),'50%');assert.equal(r.updated.length,1);
  assert.equal(next.paid,2750000);assert.equal(next.payments.length,2);
  assert.equal(next.payments.reduce((s,p)=>s+p.amount,0),5500000);
  assert.equal(next.payments[0].paidConfirmed,true);assert.equal(next.payments[1].paidConfirmed,false);
  assert.equal(next.payments[0].amount,2750000);assert.equal(next.payments[1].amount,2750000);
  assert.equal(next.payments[1].label,'잔금');assert.equal(next.payments[1].no,2);
  for(const p of next.payments){assert.equal(p.paidAt,'');assert.equal(p.dueAt,'2026-10-01');assert.equal(p.memo,'보존');}
  assert.equal(run(next,'50%').r.unchanged,1);
  assert.equal(run(next,'').r.updated.length,0);
  assert.equal(run(next,'25%').r.blocked.length,1);
  const completed=run(next,'V');assert.equal(completed.next.paid,5500000);assert.equal(completed.next.payments.length,2);
  assert.ok(completed.next.payments.every(p=>p.paidConfirmed));
});
test('partial progresses cumulatively, not by adding the source amount again',()=>{
  const a=run(lead(),'30%').next,b=run(a,'50%').next,c=run(b,'100%').next;
  assert.equal(a.paid,1650000);assert.equal(b.paid,2750000);assert.equal(c.paid,5500000);
  assert.equal(c.payments.reduce((s,p)=>s+p.amount,0),5500000);
  assert.equal(run(c,'100%').r.updated.length,0);
});
test('already paid installments keep actual dates when confirming the remaining balance',()=>{
  const original=lead({paid:2500000,payments:[{id:'a',amount:2500000,paidAt:'2026-09-19',memo:'확인'},{id:'b',amount:3000000,paidAt:''}]});
  const {next}=run(original,'V');assert.deepEqual(next.payments[0],original.payments[0]);
  assert.equal(next.payments[1].paidConfirmed,true);assert.equal(next.paid,5500000);
});
test('equal 50/50 installments select the explicitly labeled advance, not the balance',()=>{
  const {next,r}=run(lead({payments:[{id:'balance',label:'잔금',amount:2750000},{id:'advance',label:'선금',amount:2750000}]}),'50%');
  assert.equal(r.updated.length,1);assert.equal(next.payments[0].paidConfirmed,undefined);
  assert.equal(next.payments[1].paidConfirmed,true);assert.equal(next.paid,2750000);
});
test('empty schedule is created only against an exact known total',()=>{
  const {next}=run(lead({payments:[],contractAmount:5500000,status:'계약 완료'}),'50%');
  assert.equal(next.payments.length,2);assert.equal(next.paid,2750000);
  assert.equal(run(lead({payments:[],expected:0}),'V').r.blocked.length,1);
});
test('ambiguous installments, ownership, duplicate companies and manual financial edits stay untouched',()=>{
  const duplicates=lead({payments:[{id:'a',amount:2750000},{id:'b',amount:2750000}]});
  assert.equal(run(duplicates,'50%').r.blocked.length,1);
  assert.equal(run(lead({payments:[{id:'a',amount:5500000,crmManaged:true}]}),'V').r.blocked.length,1);
  assert.equal(run(lead({contractAmount:6000000}),'V').r.blocked.length,1);
  assert.equal(plan(source('V'),{leads:[lead(),lead({id:'two'})]},now,hash).updated.length,0);
  const partial=run(lead(),'50%').next;partial.payments[0].amount-=1;partial.payments[1].amount+=1;
  assert.equal(run(partial,'V').r.blocked.length,1);
});
test('unrelated note edits and adding an actual date do not invalidate a later cumulative confirmation',()=>{
  const partial=run(lead(),'50%').next;partial.payments[0].memo='수정';partial.payments[0].paidAt='2026-09-20';
  const {next,r}=run(partial,'V');assert.equal(r.updated.length,1);assert.equal(next.payments[0].paidAt,'2026-09-20');
});
test('fractional percentages round in won and never change the schedule total',()=>{
  const {next}=run(lead(),'33.333%');assert.equal(next.paid,1833315);assert.equal(next.payments.reduce((s,p)=>s+p.amount,0),5500000);
});
