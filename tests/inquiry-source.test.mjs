import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectWebsiteInquiries, inquiryDay, inquiryDates, commitInquiryReport } from '../supabase/functions/_shared/website-inquiries.mjs';
import { buildInquiryReport, inquiryPeriod, inquiryDailyActivity } from '../src/data/inquiryMetrics.js';
const hash = async value => createHash('sha256').update(value).digest('hex');
const sourceRow = (id, state, day='2026-10-01', channel='google') => ({ iciq_no:id,iciq_type:'default',state,reg_dt:day+'T10:00:00+09:00',iciq_items:{inflow_rt:[channel]},iciq_content:'synthetic only',iciq_number:'synthetic-not-a-phone' });
function source({ lists = {0:[],1:[]}, maxPage=2, mutate=rows=>rows, failState }={}) {
  const calls=[];
  return {calls,fetcher:async (raw,options)=>{
    const url=new URL(raw);assert.equal(url.origin,'https://api.xn--9i1b674cwc38r6pa.com');assert.equal(url.pathname,'/crm/v3/income_inquiry');
    assert.equal(options.redirect,'error');assert.equal(url.searchParams.get('iciq_type'),'default');
    const state=Number(url.searchParams.get('state')),offset=Number(url.searchParams.get('offset'));
    calls.push({state,offset});
    if(state===failState)return new Response('{}',{status:403});
    const list=lists[state]||[];
    return new Response(JSON.stringify({query:mutate(list.slice(offset,offset+maxPage).map(row=>({...row,row_count_for_pagination:list.length})),{state,offset})}));
  }};
}
const read = h => collectWebsiteInquiries({fetcher:h.fetcher,headers:{authorization:'synthetic-only'},start:'2026-10-01',end:'2026-10-03',hash,now:()=> '2026-10-03T09:00:00Z'});
test('read/unread, pagination, identity dedup, zero dates, safe output and channel sums agree',async()=>{
  const h=source({lists:{0:[sourceRow(1,0)],1:[sourceRow(1,1),sourceRow(2,1),sourceRow(3,1,'2026-10-03','facebook')]}});
  const r=await read(h);assert.equal(r.total,3);assert.deepEqual(r.daily.map(x=>x.count),[2,0,1]);assert.equal(r.daily[0].channels.GOOGLE,2);assert.equal(r.daily[2].channels.META,1);
  assert.ok(h.calls.some(c=>c.state===1&&c.offset===2));assert.ok(h.calls.some(c=>c.state===1&&c.offset===3));
  assert.ok(!JSON.stringify(r).includes('synthetic-not-a-phone'));assert.ok(!JSON.stringify(r).includes('iciq_no'));assert.equal(r.sourceHash.length,64);
});
test('KST date boundaries and leap dates are explicit',()=>{
  assert.equal(inquiryDay('2026-09-30T15:01:00Z'),'2026-10-01');assert.equal(inquiryDay('2026-10-01 00:01:00'),'2026-10-01');assert.equal(inquiryDay('invalid'),'');
  assert.deepEqual(inquiryDates('2024-02-28','2024-03-01'),['2024-02-28','2024-02-29','2024-03-01']);
});
for(const [name,mutate] of [
  ['missing id',rows=>rows.map(r=>({...r,iciq_no:null}))],
  ['wrong type',rows=>rows.map(r=>({...r,iciq_type:'membership'}))],
  ['wrong status',rows=>rows.map(r=>({...r,state:2}))],
  ['invalid date',rows=>rows.map(r=>({...r,reg_dt:'bad'}))],
  ['outside range',rows=>rows.map(r=>({...r,reg_dt:'2026-09-01'}))],
  ['missing count',rows=>rows.map(r=>({...r,row_count_for_pagination:undefined}))],
  ['changed total',rows=>rows.map(r=>({...r,row_count_for_pagination:5}))],
]) test('inquiry reader rejects '+name,async()=>{
  await assert.rejects(()=>read(source({lists:{0:[sourceRow(1,0)],1:[]},mutate})),/inquiry_/);
});
test('failure in the second status is never a partial successful count',async()=>{
  await assert.rejects(()=>read(source({lists:{0:[sourceRow(1,0)]},failState:1})),/inquiry_http_403/);
});
test('source identity moving dates mid-read is rejected',async()=>{
  await assert.rejects(()=>read(source({lists:{0:[sourceRow(1,0)],1:[sourceRow(1,1,'2026-10-02')]}})),/inquiry_read_changed/);
});
test('stored verification must agree with total and day count',async()=>{
  const report=await read(source());
  await assert.rejects(()=>commitInquiryReport({rpc:async()=>({data:{verified:true,total:1,days:3}})},'synthetic',report),/storage_mismatch/);
});
const tableRows=()=>['2026-10-01','2026-10-02','2026-10-03'].flatMap((date,index)=>[
  {source:'WEBSITE',inquiry_date:date,inquiry_count:index===0?2:0,channels:{META:0,NAVER:0,GOOGLE:index===0?2:0,OTHER:0},source_hash:'web'},
  {source:'META',inquiry_date:date,inquiry_count:[4,7,5][index],channels:{META:[4,7,5][index],NAVER:0,GOOGLE:0,OTHER:0},source_hash:'meta'},
]);
test('card total equals both component totals, channel totals, all daily totals including weekend',()=>{
  const report=buildInquiryReport(tableRows());const result=inquiryPeriod(report,['2026-10-01','2026-10-31'],'2026-10-03');
  assert.equal(result.website,2);assert.equal(result.meta,16);assert.equal(result.total,18);
  assert.equal(result.daily.reduce((s,x)=>s+x.count,0),18);assert.equal(Object.values(result.channels).reduce((s,n)=>s+n,0),18);
  assert.equal(inquiryDailyActivity(report,'2026-10','2026-10-03').reduce((s,d)=>s+d.count,0),18);
  assert.equal(inquiryPeriod(report,['2026-10-02','2026-10-02'],'2026-10-03').total,7);
});
test('verified zero differs from missing coverage and missing source; never fall back to CRM customers',()=>{
  const rows=tableRows();const report=buildInquiryReport(rows);
  assert.equal(inquiryPeriod(report,['2026-10-02','2026-10-02'],'2026-10-03').website,0);
  assert.equal(inquiryPeriod(report,['2026-09-01','2026-09-30'],'2026-10-03').total,null);
  assert.equal(inquiryPeriod(buildInquiryReport(rows.filter(r=>r.source==='WEBSITE')),['2026-10-01','2026-10-03'],'2026-10-03').total,null);
  assert.equal(inquiryPeriod(null,['2026-10-01','2026-10-03'],'2026-10-03').total,null);
});
test('aggregate sources never pretend to know new/existing identities',()=>{
  for(const type of ['신규','기존']) {const r=inquiryPeriod(buildInquiryReport(tableRows()),['2026-10-01','2026-10-03'],'2026-10-03',type);assert.equal(r.total,null);assert.ok(r.daily.every(d=>d.count===null));assert.match(r.error,/구분/);}
});
test('duplicate source days stay unverified even when a third duplicate arrives',()=>{
  const rows=tableRows();rows.push(rows[0],rows[0]);const r=inquiryPeriod(buildInquiryReport(rows),['2026-10-01','2026-10-03'],'2026-10-03');assert.equal(r.total,null);
});
test('same total on the wrong dates is detected by the source batch digest',()=>{
  const rows=tableRows();const report=buildInquiryReport(rows,[{source:'WEBSITE',status:'SUCCESS',range_start:'2026-10-01',range_end:'2026-10-03',source_total:2,source_hash:'different'}]);
  assert.equal(report.sources.WEBSITE.status,'INCONSISTENT');assert.equal(inquiryPeriod(report,['2026-10-01','2026-10-03'],'2026-10-03').total,null);
});
test('equal total and unchanged batch hashes cannot hide a daily count moving to another date',()=>{
  const rows=tableRows();const expected=rows.filter(r=>r.source==='WEBSITE').map(r=>({date:r.inquiry_date,count:r.inquiry_count,channels:r.channels}));
  rows[0]={...rows[0],inquiry_count:0,channels:{META:0,NAVER:0,GOOGLE:0,OTHER:0}};
  rows[2]={...rows[2],inquiry_count:2,channels:{META:0,NAVER:0,GOOGLE:2,OTHER:0}};
  const report=buildInquiryReport(rows,[{source:'WEBSITE',status:'SUCCESS',range_start:'2026-10-01',range_end:'2026-10-03',source_total:2,source_hash:'web',expected_daily:expected}]);
  assert.equal(report.sources.WEBSITE.status,'INCONSISTENT');assert.equal(report.sources.WEBSITE.differences.length,2);
});
