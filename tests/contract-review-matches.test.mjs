import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {buildContractReviewItems,contractReviewErrorText} from '../src/data/contractReviewMatches.js';
import {contractReviewMonthLabel,contractReviewMonthOptions,filterContractReviewMonth} from '../src/data/contractReviewMonth.js';
import {contractReviewPreview} from '../src/data/contractReviewPreview.js';
import {buildSheetContractReport,handleSheetReport} from '../supabase/functions/_shared/contract-sheet-report.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const row=(extra={})=>({row:2,company:'가상 월정액',date:'2026-10-15',dealText:'마케팅 월관리',amount:5500000,service:'',ctype:'기존',owner:'예시 담당',paymentPercent:null,paymentAmount:0,paymentText:'',...extra});
const report=rows=>({ok:true,schemaVersion:'contract-review-source-v1',sourceHash:'a'.repeat(64),start:'2026-08-01',end:'2026-10-22',fetchedAt:new Date().toISOString(),rangeRows:rows.length,rows});
const lead=(extra={})=>({id:'old',company:'가상 월정액',status:'계약 완료',contractAt:'2026-09-04',contractAmount:5500000,paid:5500000,premeetingAt:'2026-08-14',...extra});
const review=(rows,leads=[],rest={})=>buildContractReviewItems(report(rows),{leads,...rest},{hash});

test('existing company, existing type and no October meeting cannot suppress a new October contract',async()=>{
  const result=await review([row({date:'2026-09-04'}),row()],[lead()]);
  assert.equal(result.represented,1);assert.equal(result.items.length,1);
  assert.equal(result.items[0].firstDate,'2026-10-15');assert.equal(result.items[0].matchType,'new_contract');
  assert.equal(contractReviewPreview(result.items[0]).canAdd,true);assert.equal(result.items[0].sourceRows.length,1);
});
test('three historical same-company contracts still reveal the next monthly contract; parent choice is required',async()=>{
  const result=await review([row()],[lead(),lead({id:'older',contractAt:'2026-08-01'}),lead({id:'other',contractAt:'2026-07-01'})]);
  const item=result.items[0];assert.equal(result.pending,1);assert.equal(item.candidates.length,3);
  assert.equal(contractReviewPreview(item).canAdd,false);
  assert.equal(contractReviewPreview({...item,targetId:'older'}).canAdd,true);
});
test('different months/projects are separate; large amounts are not split or added to past contracts',async()=>{
  const result=await review([row({amount:22000000}),row({row:3,date:'2026-10-16',dealText:'개발',amount:33000000})],[lead()]);
  assert.equal(result.items.length,2);assert.equal(new Set(result.items.map(x=>x.contractKey)).size,2);
  assert.deepEqual(result.items.map(x=>x.sourceAmount).sort((a,b)=>a-b),[22000000,33000000]);
  assert.ok(result.items.every(x=>x.sourceRows.length===1));
});
test('contract key survives row moves, H changes and O corrections; financial difference reopens without duplication',async()=>{
  const a=(await review([row()])).items[0];
  const b=(await review([row({row:999,paymentPercent:100,paymentText:'100%',amount:6600000})])).items[0];
  assert.equal(a.contractKey,b.contractKey);assert.notEqual(a.sourceHash,b.sourceHash);
  const result=await review([row({amount:6600000})],[lead({contractSheetContractKey:a.contractKey,contractAt:row().date})]);
  assert.equal(result.items[0].matchType,'existing_contract_difference');assert.equal(contractReviewPreview(result.items[0]).canAdd,false);
});
test('same-date ambiguous or duplicate source contracts remain visible but cannot be created',async()=>{
  const result=await review([row(),row({row:3})],[lead()]);assert.equal(result.items.length,2);
  assert.equal(new Set(result.items.map(x=>x.id)).size,2);
  assert.ok(result.items.every(x=>!contractReviewPreview(x).canAdd));
  const sameDate=await review([row()],[lead({contractAt:row().date,contractAmount:100})]);
  assert.equal(sameDate.pending,1);assert.equal(contractReviewPreview(sameDate.items[0]).canAdd,false);
});
test('archived linked contracts and compound names are not resurrected or guessed',async()=>{
  const original=(await review([row()])).items[0];
  const result=await review([row()],[lead({contractSheetContractKey:original.contractKey,archivedAt:'2026-10-01'})]);
  assert.equal(result.pending,1);assert.equal(contractReviewPreview(result.items[0]).canAdd,false);
  assert.equal(contractReviewPreview((await review([row({company:'가상A/가상B'})])).items[0]).canAdd,false);
});
test('exclusion is one source contract/evidence, not the whole company or future month',async()=>{
  const item=(await review([row()])).items[0];
  const logs=[{action:'외부 시트 제외',meta:{sourceKey:item.contractKey,sourceHash:item.sourceHash}}];
  assert.equal((await review([row()],[],{contractStatusLogs:logs})).pending,0);
  assert.equal((await review([row({date:'2026-11-15'})],[],{contractStatusLogs:logs})).pending,1);
  assert.equal((await review([row({amount:6600000})],[],{contractStatusLogs:logs})).pending,1);
});
test('contract source mode includes unknown H, returns no memo/credentials/raw H notes, and authenticates first',async()=>{
  const h=['날짜','업체명','X','프리','Y','Z','W','대금 지급 확인','입금확인 업로드','J','K','L','M','프로젝트','별도가','비고','신규/기존'];
  const r=['2026-10-15','가상 월정액','','예시 담당','','','','민감 원문 출력 금지','','','','','','마케팅','500','비공개 메모','기존'];
  const csv=[h,r].map(r=>r.join(',')).join('\n');
  const result=buildSheetContractReport(csv,{...report([]),start:'2026-10-01',end:'2026-10-22'});
  assert.equal(result.rangeRows,1);assert.equal(result.rows[0].amount,5500000);assert.equal(result.rows[0].paymentPercent,null);
  assert.equal(result.rows[0].paymentText,'');assert.ok(!JSON.stringify(result).includes('비공개'));assert.ok(!JSON.stringify(result).includes('민감'));
  let reads=0;const request=new Request('https://example.test/?start=2026-10-01&end=2026-10-22&mode=contracts');
  assert.equal((await handleSheetReport(request,{authorize:async()=>({ok:false,status:401,error:'login_required'}),readSource:async()=>reads++})).status,401);assert.equal(reads,0);
  assert.equal((await handleSheetReport(request,{authorize:async()=>({ok:true,scope:'all'}),readSource:async params=>{assert.equal(params.mode,'contracts');return result;}})).body,result);
});
test('failed source and incomplete responses never become zero missing contracts',async()=>{
  await assert.rejects(review([],null),/contract_review_not_deployed/);
  await assert.rejects(buildContractReviewItems({...report([]),rangeRows:1},{leads:[]},{hash}),/contract_review_not_deployed/);
  assert.match(contractReviewErrorText('sheet_headers_invalid'),/원본 검증 실패/);
  assert.match(contractReviewErrorText('remote_save_timeout'),/저장 확인/);
});
test('actual read-only refresh does not await pending save, collect source automatically, or mutate global save lock',async()=>{
  const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8'),start=main.indexOf('  const refreshContractReview = async'),end=main.indexOf('  useEffect(',start);
  let waited=0,reads=0;const calls=[];
  const scope={contractReviewRunning:{current:false},window:{crmRemoteApplied:true,crmRemoteLoaded:true,crmSyncInProgress:false,crmWaitForRemoteCommit:async()=>{waited++;throw Error('remote_save_timeout');},crmFetchContractSheetChanges:async()=>{reads++;return {items:[],pending:0};}},setContractReviewError:x=>calls.push(x),setContractReviewBusy:()=>{},setContractReview:()=>{},contractReviewErrorText,toast:()=>{},setContractAutoSync:()=>{}};
  vm.createContext(scope);vm.runInContext(main.slice(start,end)+';globalThis.refresh=refreshContractReview;',scope);
  await scope.refresh(true,false);assert.equal(waited,0);assert.equal(reads,1);assert.equal(scope.window.crmSyncInProgress,false);
  await scope.refresh(true,true);assert.equal(waited,1);assert.ok(calls.includes('remote_save_timeout'));
});

test('actual review dialog renders monthly candidates, real select options, explicit actions and failed/loading states',async()=>{
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 const start=main.indexOf('<Modal open={contractReviewOpen}'),end=main.indexOf('<Modal open={contractLogOpen}',start);
 const jsx=main.slice(start,end).trim();
 const ui=readFileSync(new URL('../src/components/KpiUi.jsx',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replaceAll('export const ','const ');
 const controls=await transformWithOxc(ui,'ui.jsx',{jsx:{runtime:'classic'}});
 const {Sel,Btn,Chip}=new Function('React',controls.code+';return {Sel,Btn,Chip};')(React);
 const first=(await review([row({company:'가상 월정액A'})],[lead({company:'가상 월정액A'})])).items[0];
 const second=(await review([row({company:'가상 월정액B'})],[lead({company:'가상 월정액B'}),lead({id:'two',company:'가상 월정액B',contractAt:'2026-08-01'})])).items[0];
 const noop=()=>{},icon=()=>null;
 const scope={contractReviewOpen:true,contractApplyingId:'',contractReview:{pending:2,comparedRows:3,represented:1,excluded:0,databaseRevision:'synthetic',sourceCutoff:'2026-08-01'},contractReviewBusy:false,contractReviewError:'',contractReviewVisible:[first,second],setContractReviewOpen:noop,refreshContractReview:noop,contractReviewPreview,contractReviewErrorText,currentAccount:{serverRole:'OWNER'},fmtWon:v=>String(v),setContractReviewTargets:noop,openLead:noop,ignoreContractReviewItem:noop,applyContractReviewItem:noop,Modal:({children,title})=>React.createElement('section',null,title,children),Empty:({text})=>React.createElement('p',null,text),RefreshCw:icon,ExternalLink:icon,Plus:icon,Sel,Btn,Chip};
 const transformed=await transformWithOxc('function Dialog(){return ('+jsx+');}','dialog.jsx',{jsx:{runtime:'classic'}});
 Object.assign(scope,{contractReviewMonth:'2026-10',setContractReviewMonth:noop,contractReviewMonthLabel,contractReviewAll:[first,second],contractReviewMonths:contractReviewMonthOptions([first,second],{start:'2026-08-01',today:'2026-10-22',selected:'2026-10'})});
 const render=values=>{const s={...scope,...values};const Dialog=new Function('React',...Object.keys(s),transformed.code+';return Dialog;')(React,...Object.values(s));return renderToStaticMarkup(React.createElement(Dialog));};
 const html=render({});assert.match(html,/가상 월정액A/);assert.match(html,/가상 월정액B/);assert.match(html,/2026-10-15/);assert.match(html,/별도 계약으로 추가/);assert.match(html,/aria-label="별도 계약의 기존 업체 연결"/);assert.match(html,/<option value="two"/);
 const failed=render({contractReviewError:'sheet_source_unavailable'});assert.match(failed,/시트 원본 검증 실패/);assert.doesNotMatch(failed,/별도 계약으로 추가/);
 const loading=render({contractReviewBusy:true});assert.match(loading,/계약 시트와 현재 DB를 대조/);assert.doesNotMatch(loading,/별도 계약으로 추가/);
 assert.match(html,/aria-label="시트 계약 조회 월"/);assert.match(html,/<option value="2026-10" selected="">2026년 10월 · 2건/);assert.match(html,/전체 대조 후보 2건/);
 assert.doesNotMatch(failed,/전체 대조 후보|2026년 10월 · 2건/);assert.doesNotMatch(loading,/전체 대조 후보|2026년 10월 · 2건/);
 const empty=render({contractReviewMonth:'2026-09',contractReviewVisible:[]});assert.match(empty,/2026년 9월에 새로 추가하거나 대조할 계약이 없습니다/);assert.match(empty,/다른 월 후보 2건 · 전체 기간 보기/);assert.doesNotMatch(empty,/가상 월정액A|별도 계약으로 추가/);
 const all=render({contractReviewMonth:'all'});assert.match(all,/전체 기간 2건/);assert.match(all,/가상 월정액A/);assert.match(all,/가상 월정액B/);
 const august={...first,id:'synthetic-august',company:'가상 8월 전용',firstDate:'2026-08-15',sourceRows:[{...first.sourceRows[0],date:'2026-08-15'}],candidates:[]};
 const mixed=[first,august],augustHtml=render({contractReviewMonth:'2026-08',contractReviewAll:mixed,contractReviewVisible:filterContractReviewMonth(mixed,'2026-08')});assert.match(augustHtml,/가상 8월 전용/);assert.doesNotMatch(augustHtml,/가상 월정액A/);
});
