import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSheetPaymentReport,readSheetPaymentReport,handleSheetReport,CONTRACT_SHEET_URL } from '../supabase/functions/_shared/contract-sheet-report.mjs';

const headers=['날짜','업체명','X','프리','Y','Z','W','대금 지급 확인','입금확인 업로드','J','K','L','M','프로젝트','별도가','비고','신규/기존'];
const row=(date,name,h,amount,extra={})=>Object.assign([date,name,'','담당 A','','','',h,'','','','','','투자유치',amount,'','신규'],extra);
const csv=rows=>[headers,...rows].map(r=>r.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
const options={start:'2026-10-01',end:'2026-10-31',fetchedAt:'2026-10-22T01:00:00Z',sourceHash:'a'.repeat(64)};

test('A month and H confirmations cover sheet-only companies, percentages, VAT and multiple contracts without CRM joins',()=>{
  const result=buildSheetPaymentReport(csv([
    row('26.10.01','가상 A','V','500'),row('2026-10-02','가상 B','50%','100'),
    row('2026-09-30','가상 제외','✔','900'),row('2026-10-03','가상 A','✔','100 (포함가)'),
    row('2026-10-04','가상 I만','','100',{8:'✔'}),row('2026-10-05','가상 0','0%','100'),
  ]),options);
  assert.equal(result.rangeRows,5);assert.equal(result.rows.length,3);assert.equal(result.total,7050000);
  assert.deepEqual(result.rows.map(r=>r.amount),[5500000,1000000,550000]);
  assert.equal(result.issues[0].code,'sheet_payment_unconfirmed');
  assert.ok(result.rows.every(r=>!('paidAt'in r)&&!('memo'in r)&&!('paymentText'in r)));
  assert.equal(result.basis,'sheet-date-current-confirmation');
});
test('continuation rows inherit only their own company/date, duplicate rows are held rather than silently doubled',()=>{
  const a=row('2026-10-01','가상 A','100%','100');
  const result=buildSheetPaymentReport(csv([a,a,row('2026-10-02','가상 B','100%','200'),row('','','50%','100')]),options);
  assert.equal(result.total,2750000);assert.equal(result.rows.length,2);assert.equal(result.issues.length,2);
  assert.ok(result.issues.every(r=>r.code==='duplicate_source_row'));
});
test('malformed dates/headers/HTML/truncation fail closed and unchecked values are not paid',()=>{
  assert.throws(()=>buildSheetPaymentReport('<html>login</html>',options),/sheet_source_invalid/);
  assert.throws(()=>buildSheetPaymentReport(csv([row('2026-02-31','가상 A','✔','100')]),options),/sheet_row_date_invalid/);
  assert.throws(()=>buildSheetPaymentReport(csv([row('2026-10-01','가상 A','✔','100')]).replace('대금 지급 확인','다른 열'),options),/sheet_headers_invalid/);
  assert.throws(()=>buildSheetPaymentReport(csv([row('2026-10-01','가상 A','✔','100')])+'"',options),/sheet_csv_truncated/);
  const result=buildSheetPaymentReport(csv([row('2026-10-01','가상 A','V','미정'),row('2026-10-02','가상 B','진행중','100')]),options);
  assert.equal(result.total,0);assert.equal(result.issues.length,2);
});
test('fixed public source is read only, hashes reflect exact source, source errors never become empty success',async()=>{
  const raw=csv([row('2026-10-01','가상 A','✔','100')]);let requested;
  const result=await readSheetPaymentReport({...options,now:()=>options.fetchedAt,fetchImpl:async(url,init)=>{requested={url,init};return new Response(raw,{headers:{'content-type':'text/csv'}});}});
  assert.equal(requested.url,CONTRACT_SHEET_URL);assert.equal(requested.init.method,undefined);assert.match(result.sourceHash,/^[a-f0-9]{64}$/);
  await assert.rejects(readSheetPaymentReport({...options,fetchImpl:async()=>new Response('denied',{status:403})}),/sheet_source_unavailable/);
});
test('endpoint authenticates current membership before source read, rejects restricted scope/mutations/arbitrary URLs',async()=>{
  let reads=0;const deps={authorize:async()=>({ok:false,status:401,error:'login_required'}),readSource:async()=>{reads++;return {ok:true};}};
  const req=new Request('https://example.test/?start=2026-10-01&end=2026-10-31');
  assert.equal((await handleSheetReport(req,deps)).status,401);assert.equal(reads,0);
  deps.authorize=async()=>({ok:true,scope:'premeeting'});assert.equal((await handleSheetReport(req,deps)).status,403);assert.equal(reads,0);
  deps.authorize=async()=>({ok:true,scope:'all'});assert.equal((await handleSheetReport(new Request(req.url,{method:'POST'}),deps)).status,405);
  assert.equal((await handleSheetReport(new Request(req.url+'&url=https://example.test'),deps)).status,400);
  assert.equal((await handleSheetReport(req,deps)).status,200);assert.equal(reads,1);
  deps.readSource=async()=>{throw Error('secret provider content');};assert.deepEqual((await handleSheetReport(req,deps)).body,{error:'sheet_source_unavailable'});
});
test('new reader uses existing employee verifier, explicit origins, no financial mutation or source memo output',()=>{
  const source=readFileSync(new URL('../supabase/functions/kpi-contract-sheet-report/index.ts',import.meta.url),'utf8');
  assert.match(source,/supabase\.auth\.getUser\(token\)/);assert.match(source,/\.eq\('organization_id',org\)\.eq\('user_id',user\)/);
  assert.match(source,/pk_password_change/);assert.match(source,/authorizeEmployee/);
  assert.doesNotMatch(source,/\.insert\(|\.update\(|\.upsert\(|\.delete\(|console\.|access-control-allow-origin.*['"]\*/);
});
