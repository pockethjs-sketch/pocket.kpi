import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reconcileMarketingDailyInquiries } from '../src/data/marketingInquiry.js';

const channelGroup = (channel) => channel;

test('Supabase ad conversions and CRM inquiries remain separate dated facts', () => {
  const rows = [{ date: '2026-09-17', spend: 202080, crm: 5 }];
  const leads = [
    { createdAt: '2026-09-17', channel: 'META' },
    { createdAt: '2026-09-17T08:00:00', channel: 'META' },
    { createdAt: '2026-09-17', channel: 'NAVER' },
    { createdAt: '2026-09-16', channel: 'META' },
  ];
  const result = reconcileMarketingDailyInquiries(rows, leads, 'META', channelGroup, 'supabase-marketing-v2');
  assert.equal(result[0].crm, 2);
  assert.equal(result[0].media, 5);
  assert.equal(result[0].spend, 202080);
  assert.equal(rows[0].crm, 5);
});

test('legacy sheet media column is retained while CRM count comes from current leads', () => {
  const result = reconcileMarketingDailyInquiries([{ date: '2026-09-17', crm: 0, media: 7 }], [{ createdAt: '2026-09-17', channel: 'META' }], 'META', channelGroup, 'legacy');
  assert.equal(result[0].crm, 1);
  assert.equal(result[0].media, 7);
});

test('six top-level marketing cards open real-value breakdown and ROAS status', () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(source, /metricCards\.map\(\(m\) =>/);
  assert.match(source, /onClick=\{\(\) => setMetricDetail\(m\.key\)\}/);
  assert.match(source, /유입 코호트 누적 입금/);
  assert.match(source, /metricLeads\.map\(\(lead\) =>/);
  assert.match(source, /매체 문의전환 = 광고 플랫폼/);
  assert.match(source, /directSources\[key\]/);
  assert.match(source, /configured: !!\(direct\.lastSuccessAt \|\| direct\.status === "SUCCESS"/);
});
