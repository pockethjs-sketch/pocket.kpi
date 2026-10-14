// Unlinked schedules remain display-only; never create/save a lead for them.
import { dailyStageActivity } from './performanceMetrics.js';
export function calendarActivityLeads(calendar, leads) {
  return (calendar || []).map(meeting => {
    const matches = (leads || []).filter(lead =>
      (meeting.clientNo != null && lead.id === 'crm-' + meeting.clientNo)
      || (meeting.projNo != null && String(lead.projNo ?? '') === String(meeting.projNo)));
    const linked = matches.length === 1 ? matches[0] : null;
    return { ...(linked || {}), id: linked?.id || '', company: linked?.company || meeting.company,
      salesOwner: linked?.salesOwner || meeting.owner, ctype: linked?.ctype || '미분류',
      crmMeetings: [meeting], crmMeeting: null };
  });
}

// Cards, comparisons, costs, exports and drilldowns use these exact schedule rows.
export function calendarPeriodEntries(calendar, leads, range, today, customerType = '전체') {
  if (!Array.isArray(calendar)) return null;
  const source = calendarActivityLeads(calendar, leads).filter(lead => customerType === '전체' || lead.ctype === customerType);
  const months = new Set(calendar.flatMap(meeting => {
    const raw = String(meeting.startAt || '');
    const date = new Date(/[T ]/.test(raw) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw.replace(' ', 'T') + '+09:00' : raw);
    if (Number.isNaN(date.getTime())) return [];
    return [new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 7)];
  }));
  return [...months].sort().flatMap(month => dailyStageActivity(source, 'pre', month, today, range)
    .flatMap(day => day.entries.map(entry => ({ ...entry, date: day.date }))));
}
