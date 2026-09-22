function text(value) {
  return String(value || '').trim();
}

function timestampOf(record) {
  const date = text(record?.date);
  const time = text(record?.time) || '00:00';
  return `${date}T${time}|${text(record?.createdAt)}|${text(record?.id)}`;
}

export function dailyMeetingRecords(records = []) {
  return records
    .filter((record) => record?.kind === 'meeting')
    .slice()
    .sort((left, right) => timestampOf(left).localeCompare(timestampOf(right)));
}

export function dailyMeetingContent(record = {}) {
  const direct = text(record.content);
  if (direct) return direct;
  return [record.agenda || record.action, record.decision, record.followUp]
    .map(text)
    .filter(Boolean)
    .join('\n');
}

export function buildDailyMeetingRecord(draft = {}, meta = {}) {
  const content = text(draft.content);
  if (!content) throw new Error('meeting_content_required');

  return {
    id: text(meta.id),
    kind: 'meeting',
    status: '기록',
    date: text(draft.date),
    content,
    createdAt: text(meta.createdAt),
    // 구형 마케팅 로그 원장에서도 회의내용을 잃지 않도록 호환 필드를 유지합니다.
    action: content,
    note: content,
    channel: '데일리 회의',
  };
}
