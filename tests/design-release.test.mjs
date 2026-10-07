import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connectionPresentation } from '../src/data/connectionPresentation.js';
const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
test('connection presentation never calls loading, failed or unknown state healthy', () => {
  for (const state of ['', '불러오는 중', '캐시 데이터 표시 · 원격 확인 실패', '서버 반영 대기 · 로컬 임시 저장', '동기화 충돌 · 새로고침 필요', '저장 중…', '뜻밖의 상태']) assert.equal(connectionPresentation(state).ok, false, state);
  for (const state of ['저장됨', '최신 데이터 확인됨', '최신 데이터 반영됨', '동기화 반영 · Supabase 저장 확인', 'Supabase 최신 광고 데이터 반영됨']) assert.equal(connectionPresentation(state).ok, true, state);
});
test('production presentation has icons and bottom notes, but no preview startup or offline fixtures', () => {
  assert.match(main, /<MetricIcon label=\{label\}/);
  assert.match(main, /<StageIcon stage=\{s.id\}/);
  assert.match(main, /data-kpi-view=\{effectiveView\}/);
  assert.match(main, /key: "supabase"/);
  assert.ok(!main.includes('구글시트 연동중'));
  assert.ok(!main.includes('디자인 미리보기 · 예시 데이터'));
  assert.ok(!main.includes("new URLSearchParams(location.search).get('view')"));
  assert.match(main, /navOpen && <span>\{saveState\}<\/span>/);
  assert.ok(main.indexOf('className="kpi-method-notes"') > main.indexOf('<DailyMeetingRecords'));
});
test('approved theme preserves dark receivables and compact marketing table scope', () => {
  const css = readFileSync(new URL('../src/design.css', import.meta.url), 'utf8');
  assert.match(css, /\.receivables-table thead\{background:var\(--rt-bg\)!important/);
  assert.match(css, /\.marketing-hub-table td \{ height:40px; font-size:12px!important/);
  assert.ok(!css.includes('#preview-tools'));
  assert.ok(!css.includes('data-preview='));
});
