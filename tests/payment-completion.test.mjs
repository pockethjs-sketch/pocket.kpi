import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setPaymentPaidDate,setPaymentConfirmed} from '../src/data/paymentSchedule.js';
test('real date and completion flag are saved together; financial fields remain unchanged',()=>{
  const p={id:'synthetic',amount:100,dueAt:'2026-09-01',memo:'keep',paidAt:'',paidConfirmed:false,actualPaidAtUnknown:true};
  setPaymentPaidDate(p,'2026-10-29');assert.equal(p.paidConfirmed,true);assert.equal(p.paidAt,'2026-10-29');
  assert.equal(p.actualPaidAtUnknown,undefined);assert.equal(p.amount,100);assert.equal(p.memo,'keep');
});
test('undated completion never invents today or a due date',()=>{
  const p={amount:100,dueAt:'2026-09-01',paidAt:''};setPaymentConfirmed(p,true);
  assert.equal(p.paidAt,'');assert.equal(p.paidConfirmed,true);assert.equal(p.actualPaidAtUnknown,true);
  setPaymentConfirmed(p,false);assert.equal(p.paidAt,'');assert.equal(p.paidConfirmed,false);
});
test('completion toggle cannot erase an existing received date',()=>{
  const p={amount:100,paidAt:'2026-09-01',paidConfirmed:false};setPaymentConfirmed(p,true);
  const before=structuredClone(p);assert.throws(()=>setPaymentConfirmed(p,false),/explicit_cancellation/);
  assert.deepEqual(p,before);assert.throws(()=>setPaymentPaidDate(p,''),/explicit_cancellation/);assert.deepEqual(p,before);
});
test('invalid dates fail without mutation',()=>{
  const p={amount:100,paidAt:''};for(const d of ['2026-02-30','today','2026-1-01'])assert.throws(()=>setPaymentPaidDate(p,d));
  assert.deepEqual(p,{amount:100,paidAt:''});
});
test('actual modal uses both atomic helpers and no inferred receipt date',()=>{
  const src=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
  const modal=src.slice(src.indexOf('function PayModal('),src.indexOf('function PayModal(')+14000);
  assert.match(modal,/setPaymentPaidDate\(p, v\)/);assert.match(modal,/setPaymentConfirmed\(t, !wasDone\)/);
  assert.doesNotMatch(modal,/t\.paidAt = wasDone/);assert.doesNotMatch(modal,/입금일 자동 입력/);
});
