import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { verifyCalendarConsistency } from '../supabase/functions/_shared/calendar-consistency.mjs';
import { crmCalendar } from '../supabase/functions/_shared/crm-calendar.mjs';
import { assessCalendarDisplay } from '../src/data/calendarConsistency.js';

const options = {start:'2026-09-30', end:'2026-10-14', today:'2026-10-14'};
const raw = Array.from({length:29}, (_, i) => ({ id:i + 1, external_id:String(i + 1), last_seen_at:'2026-10-14T00:02:00Z',
  payload:{mr_type:1,client_no:i % 21, start_dt:`2026-10-${i < 3 ? '08' : i < 6 ? '14' : '03'}T10:00:00+09:00`,
    mr_checked:i % 2, client_name:'SYNTHETIC_PRIVATE_NAME', note:'SYNTHETIC_PRIVATE_NOTE'} }));
const good = () => verifyCalendarConsistency(raw, options);
test('daily job compares raw/API/screen-model totals and every date including weekends/unlinked schedules', () => {
  const result=good();
  assert.equal(result.verified,true);
  for(const layer of ['source','api','screen']) {
    assert.equal(result[layer].total,29);
    assert.equal(result[layer].daily['2026-10-08'],3);
    assert.equal(result[layer].daily['2026-10-14'],3);
    assert.equal(result[layer].daily['2026-10-03'],23);
  }
  assert.equal(result.screen.dailyTotal,29);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE'));
  assert.ok(!JSON.stringify(result).includes('client_no'));
});
test('21-card regression and a missing October8 day are explicit mismatches, not successful reads', () => {
  const total=verifyCalendarConsistency(raw,{...options,screenEntries:Array(21)});
  assert.equal(total.verified,false);
  assert.equal(total.screen.total,21);
  const daily=verifyCalendarConsistency(raw,{...options,screenDays:[{date:'2026-10-03',count:23},{date:'2026-10-14',count:3}]});
  assert.equal(daily.verified,false);
  assert.deepEqual(daily.differences,[{date:'2026-10-08',source:3,api:3,screen:0,missing:3}]);
});
test('API identity/date swaps are detected even if total count does not change', () => {
  const calendar=crmCalendar(raw);
  calendar[0]={...calendar[0],msNo:'synthetic-wrong-id'};
  const ids=verifyCalendarConsistency(raw,{...options,calendar});
  assert.equal(ids.source.total,ids.api.total);
  assert.equal(ids.verified,false);
  assert.equal(ids.identityMismatch,2);
  calendar[0]=crmCalendar(raw)[0]; calendar[0].startAt='2026-10-14T12:00:00+09:00';
  const dates=verifyCalendarConsistency(raw,{...options,calendar});
  assert.equal(dates.verified,false); assert.equal(dates.differences.length,2);
});
test('latest raw version and KST boundaries are independent of visit checks, exclude future/type2', () => {
  const records=[
    {id:1,external_id:'1',last_seen_at:'a',payload:{mr_type:1,start_dt:'2026-10-07'}},
    {id:2,external_id:'1',last_seen_at:'b',payload:{mr_type:2,start_dt:'2026-10-07'}},
    {id:3,external_id:'2',last_seen_at:'b',payload:{mr_type:1,start_dt:'2026-09-29T16:00:00Z'}},
    {id:4,external_id:'3',last_seen_at:'b',payload:{mr_type:1,start_dt:'2026-10-15'}},
  ];
  const result=verifyCalendarConsistency(records,options);
  assert.equal(result.verified,true); assert.deepEqual(result.source.daily,{'2026-09-30':1});
  assert.equal(verifyCalendarConsistency([],options).verified,true);
  assert.equal(verifyCalendarConsistency(raw,{...options,calendar:null}).verified,false);
});
test('actual displayed card 21 versus source29 and daily omissions trigger client warnings', () => {
  const scope={range:['2026-10-01','2026-10-31'],today:options.today};
  assert.equal(assessCalendarDisplay(good(),29,scope).state,'ok');
  const bad=assessCalendarDisplay(good(),21,scope);
  assert.equal(bad.state,'mismatch'); assert.equal(bad.sourceTotal,29); assert.equal(bad.screenTotal,21);
  const missing=assessCalendarDisplay(good(),29,{...scope,month:'2026-10',days:[{date:'2026-10-03',count:23},{date:'2026-10-14',count:3}]});
  assert.equal(missing.state,'mismatch'); assert.equal(missing.differences[0].date,'2026-10-08');
  assert.equal(missing.differences[0].missing,3);
});
test('day/month scope and graph weekend hiding do not create false alarms', () => {
  const scope={range:['2026-10-08','2026-10-08'],today:options.today,month:'2026-10',days:[{date:'2026-10-08',count:3}]};
  assert.equal(assessCalendarDisplay(good(),3,scope).state,'ok');
  assert.equal(assessCalendarDisplay(good(),3,{...scope,days:[{date:'2026-10-08',count:3},{date:'2026-10-01',count:0}]}).state,'ok');
});
test('missing/stale/partial reports never become healthy or zero; customer filters are not compared with organization totals', () => {
  const scope={range:['2026-10-01','2026-10-31'],today:options.today};
  assert.equal(assessCalendarDisplay(null,0,scope).state,'pending');
  assert.equal(assessCalendarDisplay(good(),29,{...scope,today:'2026-10-15'}).state,'pending');
  assert.equal(assessCalendarDisplay(good(),29,{...scope,range:['2026-09-01','2026-10-31']}).state,'pending');
  assert.equal(assessCalendarDisplay(good(),20,{...scope,customerType:'신규'}).state,'filtered');
});
test('warning renders exact metadata differences; healthy view has no extra clutter or writes', async () => {
  const source=readFileSync(new URL('../src/components/CalendarConsistencyNotice.jsx',import.meta.url),'utf8');
  const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replace('export function','function'),'Notice.jsx',{jsx:{runtime:'classic'}});
  const Notice=new Function('React','assessCalendarDisplay',code+';return CalendarConsistencyNotice;')(React,assessCalendarDisplay);
  const props={report:good(),range:['2026-10-01','2026-10-31'],today:options.today};
  const bad=renderToStaticMarkup(React.createElement(Notice,{...props,count:21}));
  assert.match(bad,/role="alert"/); assert.match(bad,/원본 29건 \/ 화면 21건/);
  assert.equal(renderToStaticMarkup(React.createElement(Notice,{...props,count:29})), '');
  assert.ok(!source.includes('fetch(')); assert.ok(!source.includes('localStorage'));
});
test('wire up existing authorized reads, both actual views, daily verifier and graph before weekday hiding', () => {
  const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
  assert.equal((main.match(/window.crmCalendarVerification =/g)||[]).length,2);
  assert.match(main,/count=\{preCount\}[^\n]*days=\{dailyCounts\}/);
  assert.match(main,/count=\{hubCalendarEntries\?\.length \?\? null\}/);
  const sync=readFileSync(new URL('../supabase/functions/kpi-crm-sync/index.ts',import.meta.url),'utf8');
  assert.match(sync,/calendar\.aggregation[\s\S]*calendar_aggregation_mismatch/);
  assert.match(sync,/eq\('organization_id', organizationId\)\.eq\('record_type', 'MEETING'\)/);
});
