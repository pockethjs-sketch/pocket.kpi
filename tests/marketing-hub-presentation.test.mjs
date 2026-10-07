import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { contractRoasByType, contractRoasRows } from '../src/data/performanceMetrics.js';

const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const view = source.slice(source.indexOf('function MarketingHubView()'), source.indexOf('function PremeetingHubView()'));
const { code } = await transformWithOxc(view, 'MarketingHubView.jsx', { jsx: { runtime: 'classic' } });
const inR = (d, r) => !!d && d >= r[0] && d <= r[1];
function render(spend = 2500000) {
  const db = { leads: [{ id:'synthetic-prior-inflow', createdAt:'2026-09-15', contractAt:'2026-10-02', status:'계약 완료', contractAmount:11000000, paid:11000000, channel:'기타' }], channels:[{ name:'기타' }], settings:{ kpi:{ inflow:600, conv:0.25, roasTarget:550 } }, adSpend:{} };
  const scope = {
    React, useApp:()=>({ db, period:{ mode:'month', y:2026, m:10 }, go:()=>{}, openLead:()=>{} }), useState:()=>[null,()=>{}],
    pRange:p=>[`${p.y}-${String(p.m).padStart(2,'0')}-01`, `${p.y}-${String(p.m).padStart(2,'0')}-31`], inR,
    hasCompletedMeeting:()=>false, isPremeetingCompanyInRange:()=>false, actualPaid:l=>l.paid||0,
    marketingSpendForPeriod:()=>spend, marketingSpendForMonth:()=>spend, channelGroupName:x=>x,
    contractRoasByType, contractRoasRows, useExcelExport:()=>{}, meetingDoneDate:()=>'',
    pad:n=>String(n).padStart(2,'0'), todayISO:()=> '2026-10-07', pLabel:()=> '2026년 10월',
    pct:(n,d)=>d?Math.round(n/d*100):0, fmtK:n=>String(n/10000)+'만', fmtWon:n=>String(n)+'원',
    Card:({children,cls})=>React.createElement('div',{className:cls},children),
    StatBig:({label,value,sub})=>React.createElement('section',null,React.createElement('h3',null,label),React.createElement('b',null,value),React.createElement('p',null,sub)),
    SecTitle:()=>null, Btn:({children})=>React.createElement('button',null,children),
    Modal:()=>null, Empty:()=>null, Megaphone:()=>null, ExternalLink:()=>null, ChannelRoasDetails:()=>null,
  };
  const Component = new Function(...Object.keys(scope),code+'; return MarketingHubView;')(...Object.values(scope));
  return renderToStaticMarkup(React.createElement(Component));
}

test('labels explicitly preserve inflow-based paid companies alongside contract ROAS',()=>{
  const html=render();
  assert.match(html,/결제 기업 \(유입일 기준\)/);
  assert.match(html,/선택 기간 유입 기업 중 입금 확인/);
  assert.match(html,/입금일 기준이 아닙니다/);
  assert.match(html,/<h3>결제 기업 \(유입일 기준\)<\/h3><b>0<\/b>/);
  assert.match(html,/440%/);
  assert.match(view,/const paid = leads.filter\(\(l\) => actualPaid\(l\) > 0\)/);
});

test('legends distinguish monthly targets, ungraded existing ROAS and channel ROAS threshold',()=>{
  const html=render();
  for(const label of ['초록: 목표 충족','빨강: 목표 미달','보라: 기존 ROAS 구분색 (목표 판정 없음)','유입 DB 600건 이상','프리미팅 150건 이상','신규 ROAS 550% 이상','월 전체 목표와 비교','ROAS만 초록 100% 이상','이익률·손익분기점이 아닙니다']) assert.ok(html.includes(label),label);
  assert.match(html,/<td class="[^"]*text-emerald-300"><button[^>]*aria-label="전체 ROAS 계산 기업 보기"/);
});

test('unknown values are neutral rather than failed performance; both tables share density rules',()=>{
  const html=render(null);
  assert.match(html,/<td class="[^"]*text-slate-500">-<\/td>/);
  assert.equal((html.match(/class="marketing-hub-table /g)||[]).length,2);
  const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(css,/#root \.marketing-hub-table td \{[^}]*height:40px;[^}]*font-size:12px!important/);
  assert.match(css,/#root \.marketing-hub-table td button \{[^}]*min-height:24px/);
  assert.ok(!view.includes('fetch('));
});
