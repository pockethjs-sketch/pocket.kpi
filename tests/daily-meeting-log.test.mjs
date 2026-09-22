import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildDailyMeetingRecord, dailyMeetingContent, dailyMeetingRecords } from '../src/data/dailyMeetingLog.js';

test('daily meeting records keep only meetings and place the newest record at the bottom', () => {
  const rows = dailyMeetingRecords([
    { id: 'new', kind: 'meeting', date: '2026-09-22', time: '16:00', createdAt: '2026-09-22T07:00:00Z' },
    { id: 'legacy', kind: 'log', date: '2026-09-22' },
    { id: 'old', kind: 'meeting', date: '2026-09-21', time: '09:00', createdAt: '2026-09-21T00:00:00Z' },
  ]);

  assert.deepEqual(rows.map((row) => row.id), ['old', 'new']);
});

test('daily meeting record stores only date and content while preserving legacy storage compatibility', () => {
  const row = buildDailyMeetingRecord({
    date: '2026-09-22',
    content: '전일 성과를 확인하고 소재 A 예산을 유지한다.',
  }, { id: 'meeting-1', createdAt: '2026-09-22T00:30:00Z' });

  assert.equal(row.kind, 'meeting');
  assert.equal(row.content, '전일 성과를 확인하고 소재 A 예산을 유지한다.');
  assert.equal(row.action, row.content);
  assert.equal(row.note, row.content);
  assert.equal(row.channel, '데일리 회의');
});

test('daily meeting record requires content', () => {
  assert.throws(() => buildDailyMeetingRecord({ date: '2026-09-22', content: '  ' }), /meeting_content_required/);
});

test('legacy structured meeting fields remain readable as one content block', () => {
  assert.equal(dailyMeetingContent({ agenda: '주간 성과 점검', decision: '예산 유지', followUp: '내일 재확인' }), '주간 성과 점검\n예산 유지\n내일 재확인');
});

test('integrated performance uses the daily meeting feed instead of the removed marketing panels', () => {
  const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('function IntegratedPerformanceView()');
  const end = source.indexOf('function MarketingHubView()', start);
  const block = source.slice(start, end);

  assert.match(block, /데일리 회의 기록/);
  assert.match(block, /회의 기록 저장/);
  assert.match(block, /aria-label="회의 날짜"/);
  assert.match(block, /aria-label="회의내용"/);
  assert.doesNotMatch(block, /aria-label="회의 시간"|aria-label="참석자"|aria-label="회의 안건"|aria-label="결정사항"|aria-label="후속 액션"/);
  assert.doesNotMatch(block, /최근 진행 중인 마케팅 액션/);
  assert.doesNotMatch(block, /마케팅 기록 등록/);
});
