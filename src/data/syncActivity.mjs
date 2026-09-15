const SYNC_ACTIONS = new Map([
  ['외부 시트 자동 반영', 'sheet'],
  ['CRM 동기화', 'crm'],
  ['CRM 자동 동기화', 'crm'],
  ['CRM 수동 동기화', 'crm'],
]);

export function syncDate(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time + 9 * 3600000).toISOString().slice(0, 10) : '';
}

export function syncActivityRows(logs) {
  const seen = new Set();
  return (Array.isArray(logs) ? logs : []).filter(log => {
    if (!log || !SYNC_ACTIONS.has(log.action) || !log.leadId || log.ok === false || log.status === 'FAILED') return false;
    const key = log.id || JSON.stringify([log.at, log.leadId, log.action, log.meta, log.detail]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(log => ({
    ...log, sourceType: SYNC_ACTIONS.get(log.action),
    resultType: log.meta?.previousStatus === '미등록' ? 'created' : log.action === '외부 시트 자동 반영' || log.meta?.previousStatus !== undefined ? 'updated' : 'unknown',
    recordedDay: /T\d{2}:\d{2}/.test(log.at || '') ? syncDate(log.at) : '',
    // Date-only legacy logs are not assigned a made-up exact sync time.
    time: /T\d{2}:\d{2}/.test(log.at || '') && Number.isFinite(Date.parse(log.at)) ? Date.parse(log.at) : 0,
  })).sort((a, b) => b.time - a.time || String(a.id || '').localeCompare(String(b.id || '')));
}

export function filterSyncActivity(rows, { days = '7', source = 'all', result = 'all', query = '', now = new Date().toISOString() } = {}) {
  const end = syncDate(now);
  const start = days === 'all' ? '' : new Date(Date.parse(end + 'T00:00:00Z') - (Number(days) - 1) * 86400000).toISOString().slice(0, 10);
  const needle = query.trim().toLocaleLowerCase('ko-KR');
  return rows.filter(row =>
    (days === 'all' || (row.recordedDay >= start && row.recordedDay <= end)) &&
    (source === 'all' || source === row.sourceType) &&
    (result === 'all' || result === row.resultType) &&
    (!needle || [row.company, row.detail, row.source, row.action].some(value => String(value || '').toLocaleLowerCase('ko-KR').includes(needle)))
  );
}

const labels = { contractAmount: '계약액', contractAt: '계약일', status: '상태', buildup: '빌드업', buildups: '빌드업 목록', memo: '메모' };
export function syncChanges(log) {
  const before = log.meta?.before, after = log.meta?.after;
  if (before && after) return Object.keys(after).filter(key => labels[key] && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => ({ key, label: labels[key], before: before[key], after: after[key] }));
  if (log.meta?.previousStatus !== undefined && log.meta?.nextStatus !== undefined && log.meta.previousStatus !== log.meta.nextStatus)
    return [{ key: 'status', label: '상태', before: log.meta.previousStatus, after: log.meta.nextStatus }];
  return [];
}

export function formatSyncValue(key, value) {
  if (value === undefined) return '기록 없음';
  if (value === null || value === '') return '미입력';
  if (key === 'contractAmount' && Number.isFinite(Number(value))) return Number(value).toLocaleString('ko-KR') + '원';
  return Array.isArray(value) ? value.join(', ') || '미입력' : String(value);
}
