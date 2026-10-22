import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {excelTable} from '../src/data/excelTable.js';
async function compile(file,names,deps){const raw=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export default ','').replaceAll('export function ','function ');const {code}=await transformWithOxc(raw,file,{jsx:{runtime:'classic'}});return new Function(...Object.keys(deps),code+';return {'+names.join(',')+'};')(...Object.values(deps));}
const {ContractOwnerSheet}=await compile('ContractOwnerSheet.jsx',['ContractOwnerSheet'],{React,Fragment:React.Fragment});
let states,cursor,exportFactory,effect;
const {ContractSheetPayments}=await compile('ContractSheetPayments.jsx',['ContractSheetPayments'],{React,ContractOwnerSheet,excelTable,
 useState:initial=>{const i=cursor++;if(states[i]===undefined)states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useMemo:fn=>fn(),useEffect:fn=>effect=fn,useExcelExport:fn=>exportFactory=fn});
const row=(n,owner,ctype,amount,date)=>({sourceRow:n,company:'가상 '+n,owner,ctype,amount,date,program:'예시 사업',contractAmount:amount*2,percent:50,taxBasis:'별도가 × 1.1'});
const report={ok:true,schemaVersion:'sheet-payment-report-v1',start:'2026-10-01',end:'2026-10-31',fetchedAt:'2026-10-22T01:00:00Z',sourceHash:'a'.repeat(64),rows:[row(2,'담당 A','신규',100,'2026-10-01'),row(3,'담당 B','기존',200,'2026-10-02'),row(4,'담당 A','신규',300,'2026-10-03')],issues:[{sourceRow:5,date:'2026-10-04',code:'sheet_payment_unconfirmed'}],total:600,confirmedRows:3};
function render(state={}){states=[report,'',false,0,'전체','전체','','owner'];Object.assign(states,state);cursor=0;return renderToStaticMarkup(ContractSheetPayments({range:['2026-10-01','2026-10-31'],periodLabel:'2026년 10월'}));}
test('sheet-only records render in owner sheet and export all the same row amounts, no CRM required',()=>{
 const html=render();assert.match(html,/프리미팅 일정·DB 등록 여부 무관/);assert.match(html,/₩600/);assert.match(html,/3행/);assert.match(html,/확인 필요 1행/);assert.match(html,/실제 입금일/);
 const tables=exportFactory();assert.equal(tables[0].rows.length,3);assert.equal(tables[0].rows.reduce((s,r)=>s+r[8],0),600);assert.equal(tables[1].rows[0][0],5);
});
test('owner/type/search filters and original source rows share identical export totals',()=>{
 const html=render({4:'기존',7:'list'});assert.match(html,/가상 3/);assert.doesNotMatch(html,/가상 2|가상 4/);assert.equal(exportFactory()[0].rows.length,1);assert.equal(exportFactory()[0].rows[0][8],200);
 render({5:'담당 A',6:'가상 4'});assert.equal(exportFactory()[0].rows.length,1);assert.equal(exportFactory()[0].rows[0][0],4);
});
test('loading/errors never expose stale totals or export a success dataset; source failure is not DB fallback',()=>{
 const failed=render({1:'sheet_headers_invalid'});assert.match(failed,/role="alert"/);assert.doesNotMatch(failed,/₩600|가상 2/);assert.deepEqual(exportFactory(),[]);
 const loading=render({2:true});assert.match(loading,/role="status"/);assert.doesNotMatch(loading,/₩600|가상 2/);assert.deepEqual(exportFactory(),[]);
 const stale=render({0:{...report,start:'2026-09-01',end:'2026-09-30'}});assert.doesNotMatch(stale,/₩600|가상 2/);assert.deepEqual(exportFactory(),[]);
});
test('request uses employee session, abort and no-store; repeated mount cleanup cannot overwrite a newer period',()=>{
 const source=readFileSync(new URL('../src/ContractSheetPayments.jsx',import.meta.url),'utf8');
 assert.match(source,/await window\.kpiEmployeeHeaders\(\)/);assert.match(source,/signal:controller.signal,cache:'no-store'/);assert.match(source,/current=false;controller.abort\(\)/);
 assert.doesNotMatch(source,/localStorage|sheet_bridge|contract_auto_sync|\.payments|paidAt:/);
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');assert.match(main,/\['sheetPayment', '입금 현황 · 시트 기준'\]/);assert.match(main,/\['payment', '실제 입금일 기준'\]/);
});

test('actual loading effect sends the approved employee headers, validates totals and ignores results after cleanup',async()=>{
 const oldWindow=globalThis.window,oldFetch=globalThis.fetch;
 let requested,resolveResponse;
 try{
  globalThis.window={kpiEmployeeHeaders:async()=>({Authorization:'Bearer synthetic-only'})};
  globalThis.fetch=async(url,init)=>{requested={url,init};return new Response(JSON.stringify(report));};
  render({0:null,2:true});let cleanup=effect();await new Promise(setImmediate);
  assert.equal(requested.init.headers.Authorization,'Bearer synthetic-only');assert.equal(requested.init.cache,'no-store');assert.equal(states[0].total,600);assert.equal(states[2],false);cleanup();
  globalThis.fetch=()=>new Promise(resolve=>resolveResponse=resolve);
  render({0:null,2:true});cleanup=effect();await new Promise(setImmediate);cleanup();resolveResponse(new Response(JSON.stringify(report)));await new Promise(setImmediate);assert.equal(states[0],null);
  globalThis.fetch=async()=>new Response(JSON.stringify({...report,total:999}));
  render({0:null,2:true});cleanup=effect();await new Promise(setImmediate);assert.equal(states[1],'sheet_report_invalid');assert.equal(states[0],null);cleanup();
 }finally{globalThis.window=oldWindow;globalThis.fetch=oldFetch;}
});
