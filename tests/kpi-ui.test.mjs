import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import postcss from 'postcss';
import { auditKpiDesign, readTokens } from '../scripts/audit-kpi-design.mjs';

const read = path => readFileSync(new URL('../' + path,import.meta.url),'utf8');
const theme=read('src/design.css'), tokenSource=read('src/kpi-tokens.css');
const tokens=readTokens(tokenSource), report=auditKpiDesign(tokenSource,theme);
const uiSource=read('src/components/KpiUi.jsx');
const {code}=await transformWithOxc(uiSource.replace(/^import .*\r?\n/gm,'').replaceAll('export const ','const '),'KpiUi.jsx',{jsx:{runtime:'classic'}});
const {Btn,Inp,IconInput,Ta,Sel,Fld,Card,Chip,SecTitle,Seg}=new Function('React',code+';return {Btn,Inp,IconInput,Ta,Sel,Fld,Card,Chip,SecTitle,Seg};')(React);

test('warehouse tokens use ten integer sizes >=11, four weights, five radii and accessible core text pairs',()=>{
  assert.equal(report.sizes.length,10);
  assert.ok(report.sizes.every(size=>Number.isInteger(size)&&size>=11));
  assert.deepEqual(report.weights,[400,500,600,700]);
  assert.equal(report.radii.length,5);
  assert.equal(report.neutralRoles.length,6);
  assert.equal(report.contrastFailures,0);
  assert.equal(tokens['--ui-control-height'],'48px');
  assert.equal(tokens['--ui-input-height'],'50px');
  assert.equal(tokens['--ui-hit-touch'],'44px');
  assert.equal(report.browserVerified,false);
});

test('shared controls preserve values, custom classes, disabled/readOnly semantics and exact event payloads',()=>{
  let clicked=0,changed;
  const button=Btn({kind:'primary',size:'md',onClick:()=>clicked++,disabled:true,children:'확인',cls:'existing-extra'});
  assert.equal(button.props.type,'button');
  assert.equal(button.props.disabled,true);
  assert.match(button.props.className,/existing-extra/);
  button.props.onClick(); assert.equal(clicked,1);
  const event={target:{value:'synthetic'}};
  const input=Inp({value:'synthetic',readOnly:true,'aria-label':'테스트 입력',className:'w-36',onChange:e=>changed=e});
  input.props.onChange(event); assert.equal(changed,event);
  assert.equal(input.props.readOnly,true);assert.equal(input.props.value,'synthetic');assert.match(input.props.className,/w-36/);
  const area=Ta({value:'synthetic multiline',rows:4});assert.equal(area.props.rows,4);
  const select=Sel({value:'a',disabled:true,options:[{value:'a',label:'항목 A'},'b'],onChange:e=>changed=e});
  assert.equal(select.props.value,'a');assert.equal(select.props.disabled,true);assert.equal(select.props.children.length,2);
  select.props.onChange(event);assert.equal(changed,event);
});

test('shared component markup exposes labels, selected filters, preserved card children and heading actions',()=>{
  const input=React.createElement(Inp,{'aria-label':'테스트 필드',defaultValue:'synthetic'});
  const html=renderToStaticMarkup(React.createElement(Fld,{label:'기준 값'},input));
  assert.match(html,/<label/);assert.match(html,/기준 값/);assert.match(html,/테스트 필드/);
  const child=React.createElement('p',null,'synthetic value');assert.equal(Card({children:child}).props.children,child);
  assert.match(renderToStaticMarkup(React.createElement(Chip,null,'확인 필요')),/확인 필요/);
  const title=SecTitle({title:'긴 제목도 보존',right:child});assert.equal(title.props.children[1].props.children,child);
  let selected='a';const group=Seg({value:selected,options:[['a','항목 A'],['b','항목 B']],onChange:value=>selected=value});
  assert.equal(group.props.role,'group');assert.equal(group.props.children[0].props['aria-pressed'],true);
  group.props.children[1].props.onClick();assert.equal(selected,'b');
});

test('icon fields keep icon/input/clear action in separate flow slots and preserve search events',()=>{
  const Icon=props=>React.createElement('svg',props);
  const clear=React.createElement('button',{'aria-label':'검색어 지우기'},'×');
  let changed,entered;
  const field=IconInput({icon:Icon,className:'ui-global-search',value:'예시',readOnly:true,'aria-label':'통합 검색',onChange:e=>changed=e,onKeyDown:e=>entered=e,trailingAction:clear});
  const [icon,input,action]=field.props.children;
  assert.equal(icon.props['aria-hidden'],'true');
  assert.equal(input.type,Inp);assert.equal(input.props.value,'예시');assert.equal(input.props.readOnly,true);
  assert.equal(input.props['aria-label'],'통합 검색');assert.equal(action.props.children,clear);
  const change={target:{value:'예시 2'}},enter={key:'Enter'};
  input.props.onChange(change);input.props.onKeyDown(enter);assert.equal(changed,change);assert.equal(entered,enter);
  const html=renderToStaticMarkup(field);assert.match(html,/ui-input-icon/);assert.match(html,/ui-input-action/);
  assert.doesNotMatch(html,/absolute|pl-8/);
  assert.match(theme,/\.ui-icon-input\{display:flex;align-items:center/);
  assert.match(theme,/\.ui-icon-input>\.ui-icon-input-control\{flex:1 1 0%;width:0;min-width:0/);
  assert.match(theme,/\.ui-icon-input:focus-within\{border-color:var\(--ui-brand\)/);
  const main=read('src/main.jsx');
  assert.equal((main.match(/<IconInput icon=\{Search\}/g)||[]).length,5);
  assert.doesNotMatch(main,/<Inp[^>]*className="pl-8/);
});

test('payment summary wraps above a distinct meter without hiding financial text or changing calculations',()=>{
  const main=read('src/main.jsx');
  const payment=main.slice(main.indexOf('<div className="ui-payment-status">'),main.indexOf('</td>',main.indexOf('<div className="ui-payment-status">')));
  assert.match(payment,/ui-payment-summary/);assert.match(payment,/\{fmtK\(l\.paid \|\| 0\)\}/);assert.match(payment,/\{pStat\.text\}/);
  assert.match(payment,/ui-payment-meter/);assert.match(payment,/ui-payment-percent[^>]*>\{payPct\}%/);
  assert.doesNotMatch(payment,/hidden 2xl:block|truncate|absolute/);
  assert.doesNotMatch(payment.slice(payment.indexOf('ui-payment-summary'),payment.indexOf('</button>')),/whitespace-nowrap/);
  assert.match(theme,/\.ui-payment-status\{display:flex;flex-direction:column/);
  assert.match(theme,/\.ui-payment-summary\{[^}]*flex-wrap:wrap[^}]*white-space:normal/);
  assert.match(theme,/\.ui-payment-meter\{display:grid;grid-template-columns:minmax\(0,1fr\) max-content/);
  assert.match(main,/const payPct = isWon && amt \? Math\.min\(100, Math\.round\(\(l\.paid \|\| 0\) \/ amt \* 100\)\) : null/);
});

test('neutral page canvas and bordered white cards restore explicit surface hierarchy',()=>{
  assert.equal(tokens['--ui-canvas'],'#f3f4f6');assert.equal(tokens['--ui-surface'],'#ffffff');
  for(const selector of ['kpi-card','kpi-stat','kpi-stage-block']){
    assert.match(theme,new RegExp('\\.'+selector+'\\{border:1px solid var\\(--ui-line\\)!important'));
  }
  assert.match(theme,/\.kpi-method-notes>\.kpi-card\{border:0!important/);
  assert.equal(report.contrastFailures,0);
});

test('refinement selectors are KPI-scoped and preserve ledger colors and frozen contract geometry',()=>{
  const root=postcss.parse(theme);
  const outside=[];
  root.walkRules(rule=>{
    if(rule.parent?.type==='atrule'&&rule.parent.name==='font-face')return;
    if(!rule.selector.includes('.kpi-app')&&!['html[data-ui="precision"]','html[data-ui="precision"] body','html[data-ui="precision"] #root'].includes(rule.selector))outside.push(rule.selector);
  });
  assert.deepEqual(outside,[]);
  assert.match(theme,/receivables-table thead\{background:var\(--rt-bg\)!important/);
  assert.match(theme,/receivables-table-shell \*,\[role="tooltip"\] \*/);
  assert.match(theme,/contract-sheet table\{border-collapse:separate/);
  assert.doesNotMatch(theme,/contract-sheet-(?:owners|columns)[^{]*\{[^}]*top:/);
  assert.match(theme,/prefers-reduced-motion:reduce/);
  assert.match(theme,/\.kpi-stage-flow\{grid-template-columns:minmax\(0,1fr\);min-width:0/);
  assert.match(theme,/\[role="tab"\]\[aria-selected="true"\].*border-bottom-color:var\(--ui-brand\)/);
  const main=read('src/main.jsx');
  assert.match(main,/<div className="kpi-app">/);
  assert.match(main,/role="dialog" aria-modal="true" aria-label=\{title\}/);
  assert.match(main,/if \(!window.kpiEmployeeAccess\?\.userId\) throw new Error\('employee_login_required'\)/);
  assert.doesNotMatch(uiSource,/fetch\(|localStorage|employeeRequest|postMessage/);
});

test('Latin fonts are local OFL assets with four declared weights, while original sales HTML stays untouched',()=>{
  assert.match(read('src/assets/Poppins-OFL.txt'),/SIL OPEN FONT LICENSE/);
  assert.equal(read('public/licenses/Poppins-OFL.txt'),read('src/assets/Poppins-OFL.txt'));
  for(const name of ['Regular','Medium','SemiBold','Bold']){
    const font=readFileSync(new URL('../src/assets/Poppins-'+name+'.ttf',import.meta.url));
    assert.equal(font.readUInt32BE(0),0x00010000);assert.ok(font.length>10000);
  }
  assert.equal((theme.match(/font-family:'KPI Poppins'/g)||[]).length,4);
  assert.match(theme,/unicode-range:U\+0000-024F/);
  const currentAsset=new URL('../src/assets/buildup-intelligence.html',import.meta.url);
  const hasCurrent=existsSync(currentAsset);
  const original=readFileSync(hasCurrent ? currentAsset : new URL('../src/assets/buildup-intelligence-v3.html',import.meta.url));
  // The sales HTML must equal the reviewed build pinned once in workspace-shell.test.mjs (single pin, updated only with a new build).
  const pinned=(read('tests/workspace-shell.test.mjs').match(/const BUILDUP_ASSET_SHA256 = '([0-9a-f]{64})'/)||[])[1];
  assert.ok(pinned,'buildup asset pin missing in workspace-shell.test.mjs');
  assert.equal(createHash('sha256').update(original).digest('hex'),hasCurrent ? pinned : '367d69ea4ec012cc5a28a066c6765af90f98e96b2b47a2761e8c6db9559d0a99');
});
