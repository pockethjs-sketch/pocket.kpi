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

export function buildDailyMeetingRecord(draft = {}, meta = {}) {
  const agenda = text(draft.agenda);
  const decision = text(draft.decision);
  const followUp = text(draft.followUp);
  if (!agenda) throw new Error('meeting_agenda_required');
  if (!decision && !followUp) throw new Error('meeting_content_required');

  return {
    id: text(meta.id),
    kind: 'meeting',
    status: '기록',
    date: text(draft.date),
    time: text(draft.time),
    participants: text(draft.participants),
    agenda,
    decision,
    followUp,
    author: text(meta.author),
    createdAt: text(meta.createdAt),
    // 구형 마케팅 로그 원장에서도 제목과 본문을 잃지 않도록 호환 필드를 유지합니다.
    action: agenda,
    note: [decision, followUp].filter(Boolean).join('\n'),
    channel: '데일리 회의',
    owner: text(meta.author),
  };
}
