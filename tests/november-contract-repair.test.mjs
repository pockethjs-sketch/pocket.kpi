import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {confirmedContractSource,explicitReceiptDate} from '../supabase/functions/_shared/confirmed-contract-source.mjs';
import {handleConfirmedContractRepair} from '../supabase/functions/_shared/confirmed-contract-repair.mjs';
const hash=async(v,a='sha256')=>createHash(a).update(String(v)).digest('hex');
const header=['날짜','업체명','프리','프로젝트','별도가','비고','신규/기존','대금 지급 확인','입금일'];
const csv=(payment='50%',date='11/6',order=header)=>{const row={'날짜':'26-11-02','업체명':'합성상사','프리':'','프로젝트':'투A','별도가':'100','비고':'PRIVATE-NOTE','신규/기존':'기존','대금 지급 확인':payment,'입금일':date};return [order,order.map(k=>row[k])].map(r=>r.join(',')).join('\n');};
const manifest=[{keyHash:await hash('합성상사','md5'),date:'2026-11-02',amount:1100000,percent:50,parentIdHash:null,parentBeforeHash:null,mode:'new-contract'}];
test('confirmed contract source uses named columns, VAT, cumulative percentage and explicit date only',async()=>{
  const source=await confirmedContractSource(csv(),manifest,hash),row=source.rows[0];
  assert.equal(row.amount,1100000);assert.equal(row.paid,550000);assert.equal(row.paidAt,'2026-11-06');
  assert.equal(row.ctype,'기존');assert.equal(JSON.stringify(source).includes('PRIVATE-NOTE'),false);
  assert.deepEqual((await confirmedContractSource(csv('50%','11/6',[...header].reverse()),manifest,hash)).rows,source.rows);
});
test('unknown receipt dates stay empty and invalid/ambiguous dates fail closed',()=>{
  assert.equal(explicitReceiptDate('','2026-11-02'),'');
  assert.throws(()=>explicitReceiptDate('2/31','2026-11-02'),/invalid|ambiguous/);
  assert.throws(()=>explicitReceiptDate('1/2','2026-11-02'),/ambiguous/);
});
test('a changed approval amount/check or duplicate contract is rejected before any write',async()=>{
  await assert.rejects(confirmedContractSource(csv('100%'),manifest,hash),/changed/);
  await assert.rejects(confirmedContractSource(csv()+'\n'+csv().split('\n')[1],manifest,hash),/changed|duplicate/);
});
test('server never forwards source rows to its caller and requires same source hash',async()=>{
  let writes=0;
  const source={sourceHash:'a'.repeat(64),sourceRowCount:2,rows:[{company:'synthetic'}]};
  const client={rpc:async()=>{writes++;return{data:{ok:true,targetCount:14,rehearsal:true},error:null};}};
  const request={expectedSourceHash:'a'.repeat(64),baseRevision:'synthetic',dryRun:true};
  const result=await handleConfirmedContractRepair(request,client,'synthetic',{readSource:async()=>source});
  assert.equal(result.status,200);assert.equal(writes,1);assert.equal(JSON.stringify(result).includes('synthetic'),false);
  assert.equal((await handleConfirmedContractRepair({...request,expectedSourceHash:'b'.repeat(64)},client,'synthetic',{readSource:async()=>source})).status,502);
  assert.equal(writes,1);
});
test('financial transaction guards preserve old receipts/accounts/archives and rehearses real writes',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261116035048_november_confirmed_contract_repair.sql',import.meta.url),'utf8');
  for(const marker of ['security invoker','NOVEMBER_REPAIR_NOT_APPROVED','NOVEMBER_REPAIR_PARENT_CHANGED','NOVEMBER_REPAIR_OLD_RECEIPT_CHANGED','NOVEMBER_REPAIR_OLD_ACCOUNT_CHANGED','NOVEMBER_REPAIR_OLD_PLAN_CHANGED',"raise sqlstate 'PZ001'",'NOVEMBER_REPAIR_LEDGER_MISMATCH','from public,anon,authenticated'])assert.ok(sql.includes(marker));
  assert.doesNotMatch(sql,/security definer|project_v3_state\(|archived_at\s*=\s*null|delete from/i);
});
