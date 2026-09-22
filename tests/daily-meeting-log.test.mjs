import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildDailyMeetingRecord, dailyMeetingRecords } from '../src/data/dailyMeetingLog.js';

test('daily meeting records keep only meetings and place the newest record at the bottom', () => {
  const rows = dailyMeetingRecords([
    { id: 'new', kind: 'meeting', date: '2026-09-22', time: '16:00', createdAt: '2026-09-22T07:00:00Z' },
    { id: 'legacy', kind: 'log', date: '2026-09-22' },
    { id: 'old', kind: 'meeting', date: '2026-09-21', time: '09:00', createdAt: '2026-09-21T00:00:00Z' },
  ]);

  assert.deepEqual(rows.map((row) => row.id), ['old', 'new']);
});

test('daily meeting record preserves structured fields and legacy storage compatibility', () => {
  const row = buildDailyMeetingRecord({
    date: '2026-09-22',
    time: '09:30',
    participants: '마케팅팀, 영업팀',
    agenda: '주간 성과 점검',
    decision: '소재 A 예산을 유지한다.',
    followUp: '내일 오전 성과를 다시 확인한다.',
  }, { id: 'meeting-1', author: 'MASTER', createdAt: '2026-09-22T00:30:00Z' });

  assert.equal(row.kind, 'meeting');
  assert.equal(row.action, '주간 성과 점검');
  assert.equal(row.note, '소재 A 예산을 유지한다.\n내일 오전 성과를 다시 확인한다.');
  assert.equal(row.channel, '데일리 회의');
});

test('daily meeting record requires an agenda and at least one meeting result', () => {
  assert.throws(() => buildDailyMeetingRecord({ decision: '결정' }), /meeting_agenda_required/);
  assert.throws(() => buildDailyMeetingRecord({ agenda: '안건' }), /meeting_content_required/);
});

test('integrated performance uses the daily meeting feed instead of the removed marketing panels', () => {
  const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('function IntegratedPerformanceView()');
  const end = source.indexOf('function MarketingHubView()', start);
  const block = source.slice(start, end);

  assert.match(block, /데일리 회의 기록/);
  assert.match(block, /회의 기록 저장/);
  assert.doesNotMatch(block, /최근 진행 중인 마케팅 액션/);
  assert.doesNotMatch(block, /마케팅 기록 등록/);
});
