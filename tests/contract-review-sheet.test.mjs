import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
import {buildSheetContractReport} from '../supabase/functions/_shared/contract-sheet-report.mjs';
import {CONTRACT_REVIEW_COLUMNS,contractReviewSheetCells,contractReviewSheetOrder} from '../src/data/contractReviewSheet.js';
const options={start:'2026-08-01',end:'2026-10-23',fetchedAt:'2026-10-23T01:00:00Z',sourceHash:'a'.repeat(64)};
const headers=['날짜','업체명','프리','D','E','F','G','대금 지급 확인','입금확인 업로드','J','K','L','M','프로젝트','별도가','계약방식','비고','신규/기존'];
const row=(h='50%',o='4550',method='선금, 잔금')=>['2026-10-06','가상 신규개발','예시 담당','','','','',h,'✓','','','','','개발(V1)',o,method,'비공개 메모','기존'];
const csv=rows=>[headers,...rows].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');
const read=(...rows)=>buildSheetContractReport(csv(rows),options);

test('sheet columns and dimensions match reference order; source order does not mutate candidates',()=>{
 assert.deepEqual(CONTRACT_REVIEW_COLUMNS.map(c=>c[1]),['날짜','업체명','프리','대금 지급 확인','프로젝트','별도가','계약방식','신규/기존','추가 여부']);
 assert.deepEqual(CONTRACT_REVIEW_COLUMNS.map(c=>c[2]),[58,174,145,108,180,125,170,74,108]);
 const items=[{id:'later',sourceRows:[{row:99}]},{id:'first',sourceRows:[{row:12}]}],before=structuredClone(items);
 assert.deepEqual(contractReviewSheetOrder(items).map(x=>x.id),['first','later']);assert.deepEqual(items,before);
});
test('display O as source net price, never VAT-inclusive contract amount; methods stay separate tokens',()=>{
 const report=read(row()),r=report.rows[0],cells=contractReviewSheetCells({sourceRows:[r]});
 assert.equal(report.displaySchemaVersion,1);assert.equal(r.amount,50050000);assert.equal(r.netAmount,45500000);
 assert.equal(cells.price,'4550');assert.equal(cells.date,'26-10-06');assert.equal(cells.payment,'50%');assert.deepEqual(cells.methods,['선금','잔금']);assert.equal(cells.type,'기존');
 assert.equal(contractReviewSheetCells({sourceRows:[{...r}],customerTypeOverride:'신규'}).type,'기존');
 assert.equal(contractReviewSheetCells({sourceRows:[read(row('✓','400(포함가)','완납 지원금')).rows[0]]}).price,'400(포함가)');
 assert.equal(read(row('✓','400(포함가)')).rows[0].amount,4000000);
 assert.equal(contractReviewSheetCells({sourceRows:[read(row('✓','5000000원')).rows[0]]}).price,'5000000원');
});
test('H display preserves exact checks, percentages and safe scheduled month; never substitutes I or invents a paid date',()=>{
 for(const h of ['V','✓','100%'])assert.equal(read(row(h)).rows[0].paymentDisplay,'✓');
 for(const h of ['50%','0%','95%'])assert.equal(read(row(h)).rows[0].paymentDisplay,h);
 const scheduled=read(row('11월내지급예정')).rows[0];assert.equal(scheduled.paymentDisplay,'11월내지급예정');assert.equal(scheduled.paymentPercent,null);assert.equal(scheduled.paymentText,'');
 const unknown=read(row('민감 원문 출력 금지')).rows[0];assert.equal(unknown.paymentDisplay,'확인 필요');assert.equal(unknown.paymentPercent,null);
 assert.equal(read(row('')).rows[0].paymentDisplay,'');assert.equal(read(row('')).rows[0].paymentPercent,null);
 assert.equal(unknown.paidAt,undefined);assert.ok(!JSON.stringify(unknown).includes('민감'));assert.ok(!JSON.stringify(unknown).includes('비공개'));
});
test('unknown prices/method notes stay unverified, missing exact method header is not position-guessed, duplicate header fails',()=>{
 const r=read(row('','비공개 금액 메모','비공개 계약 메모')).rows[0];assert.equal(r.amountDisplay,'');assert.equal(r.contractMethodStatus,'unknown');assert.deepEqual(r.contractMethods,[]);assert.ok(!JSON.stringify(r).includes('비공개'));
 const absent=csv([row()]).replace('계약방식','다른 열');const m=buildSheetContractReport(absent,options).rows[0];assert.equal(m.contractMethodStatus,'unavailable');assert.deepEqual(m.contractMethods,[]);
 assert.throws(()=>buildSheetContractReport(csv([row()]).replace('"D"','"계약방식"'),options),/sheet_headers_invalid/);
 const legacy=contractReviewSheetCells({sourceRows:[{amount:50050000,paymentPercent:null}]});assert.equal(legacy.price,'미제공');assert.equal(legacy.methodStatus,'unavailable');assert.equal(legacy.payment,'확인 필요');
});
test('CSS isolates 21px rows and 12px type from precision defaults, fixes width and sticky header/action without zoom scaling',()=>{
 const css=readFileSync(new URL('../src/contract-review-sheet.css',import.meta.url),'utf8'),root=postcss.parse(css);
 const rules=[];root.walkRules(r=>rules.push(r));
 const cells=rules.find(r=>r.selector.endsWith('.contract-review-sheet :is(th,td)'));
 const props=Object.fromEntries(cells.nodes.filter(n=>n.type==='decl').map(n=>[n.prop,n.value]));assert.equal(props.height,'21px');assert.equal(props['font-size'],'12px');assert.equal(props['line-height'],'20px');assert.equal(props.padding,'0 4px');
 assert.match(css,/width:1142px;min-width:1142px;table-layout:fixed/);assert.match(css,/position:sticky;top:0/);assert.match(css,/position:sticky;right:0/);assert.match(css,/text-overflow:ellipsis/);assert.match(css,/overflow:auto/);assert.doesNotMatch(css,/transform:scale|zoom:/);
 assert.match(css,/\[data-held="true"\]\[aria-expanded="false"\]/);
});
