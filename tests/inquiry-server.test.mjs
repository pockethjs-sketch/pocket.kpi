import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {buildInquiryReport,inquiryPeriod} from '../src/data/inquiryMetrics.js';

const domain=readFileSync(new URL('../supabase/functions/kpi-domain-api/index.ts',import.meta.url),'utf8');
const branch=stripTypeScriptTypes('async function inquiryRead(){'+domain.slice(domain.indexOf('  if (action === "marketing")'),domain.indexOf('  if (action === "crm_refresh")'))+'}');
const readMarketing=new Function('supabase','organizationId','buildMarketing','buildInquiryReport','reply','req','action',branch+'; return inquiryRead();');
const tableRows=Array.from({length:1002},(_,i)=>({source:i%2?'META':'WEBSITE',inquiry_date:new Date(Date.UTC(2025,0,1+i/2)).toISOString().slice(0,10),inquiry_count:1,channels:i%2?{META:1,NAVER:0,GOOGLE:0,OTHER:0}:{META:0,NAVER:0,GOOGLE:0,OTHER:1},source_hash:'synthetic'}));
function server({failTable='',failOffset=-1}={}){
  const calls=[];const client={from(table){const chain={select(){return chain;},eq(_key,value){assert.equal(value,'synthetic-org');return chain;},is(){return chain;},order(){return chain;},async range(start,end){calls.push([table,start,end]);return {data:(table==='marketing_inquiry_daily'?tableRows:table==='marketing_daily_spend'?Array(1201).fill({spend_amount:1}):[]).slice(start,end+1),error:table===failTable&&start===failOffset?{code:'TEST'}:null};},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};return chain;}};
  return {calls,invoke:()=>readMarketing(client,'synthetic-org',rows=>({ledgerCount:rows.length,marketingMeta:{}}),buildInquiryReport,(_req,data,status=200)=>({data,status}),{},'marketing')};
}
test('authenticated marketing read paginates inquiry and ad ledgers beyond 1000 rows',async()=>{
  const h=server();const r=await h.invoke();assert.equal(r.status,200);assert.equal(r.data.ledgerCount,1201);
  assert.equal(r.data.marketingMeta.inquiries.daily.length,501);
  assert.ok(h.calls.some(([table,start])=>table==='marketing_inquiry_daily'&&start===1000));
  assert.ok(h.calls.some(([table,start])=>table==='marketing_daily_spend'&&start===1000));
});
test('failed second inquiry page is unverified rather than a successful partial total',async()=>{
  const r=await server({failTable:'marketing_inquiry_daily',failOffset:500}).invoke();
  assert.equal(r.data.marketingMeta.inquiries.readError,'inquiry_read_failed');
  assert.equal(inquiryPeriod(r.data.marketingMeta.inquiries,['2025-01-01','2025-01-31'],'2026-10-16').total,null);
});
test('failed advertising page fails the marketing envelope rather than truncating spend',async()=>{
  const r=await server({failTable:'marketing_daily_spend',failOffset:500}).invoke();assert.equal(r.status,500);
});

const marketing=readFileSync(new URL('../supabase/functions/kpi-marketing-sync/index.ts',import.meta.url),'utf8');
const js=stripTypeScriptTypes(marketing.replace(/^import .*\r?\n/gm,''));
async function collect({timezone='Asia/Seoul',actions=[],incomplete=false}={}){
  const context={TextEncoder,Response,URL,URLSearchParams,Date,Set,Map,Deno:{serve:()=>{}},fetch:async raw=>{
    const url=new URL(raw);const body=url.searchParams.has('fields')&&url.searchParams.get('fields')==='timezone_name'?{timezone_name:timezone}:url.pathname.endsWith('/campaigns')?{data:[{id:'synthetic',objective:'OUTCOME_LEADS'}]}:{data:[{date_start:'2026-10-01',campaign_id:'synthetic',spend:100,actions}],...(incomplete?{paging:{next:raw}}:{})};
    return new Response(JSON.stringify(body));
  }};vm.createContext(context);vm.runInContext(js,context);return vm.runInContext("collectMeta({MK_META_AD_ACCOUNT_ID:'1',MK_META_ACCESS_TOKEN:'synthetic-only'},'2026-10-01','2026-10-02')",context);
}
test('scheduled META collector counts one native lead action, never overlapping aliases',async()=>{
  const rows=await collect({actions:[{action_type:'lead',value:'999'},{action_type:'onsite_conversion.lead_grouped',value:'3'},{action_type:'offsite_complete_registration_add_meta_leads',value:'3'}]});
  assert.deepEqual(Array.from(rows,row=>row.payload.metaInquiryCount),[3,0]);
  assert.equal(rows[0].conversions,999,'reference conversions are not silently redefined');
});
test('META collector refuses non-KST reporting or incomplete pagination',async()=>{
  await assert.rejects(()=>collect({timezone:'America/Los_Angeles'}),/timezone_unverified/);
  await assert.rejects(()=>collect({incomplete:true}),/page_limit/);
});
