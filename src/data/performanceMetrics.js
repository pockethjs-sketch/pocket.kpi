const inRange = (date, range) => !range || (!!date && date >= range[0] && date <= range[1]);

export function contractRoasByType(leads, range, spend) {
  const amounts = { 신규: 0, 기존: 0 };
  for (const lead of leads || []) {
    if (lead.status !== '계약 완료' || !inRange(lead.contractAt, range)) continue;
    const type = lead.ctype === '기존' ? '기존' : '신규';
    const paymentSum = (lead.payments || []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    amounts[type] += Number(lead.contractAmount) || paymentSum || 0;
  }
  const roas = amount => spend > 0 ? Math.round(amount / spend * 100) : null;
  return {
    amount: amounts.신규 + amounts.기존,
    newAmount: amounts.신규,
    existingAmount: amounts.기존,
    totalRoas: roas(amounts.신규 + amounts.기존),
    newRoas: roas(amounts.신규),
    existingRoas: roas(amounts.기존),
  };
}

export function dailyLeadCounts(leads, month, today) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return [];
  const [year, monthNumber] = month.split('-').map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const lastDay = month === (today || '').slice(0, 7) ? Math.min(days, Number(today.slice(8, 10))) : days;
  const counts = new Map();
  for (const lead of leads || []) {
    const date = String(lead.createdAt || '').slice(0, 10);
    if (date.startsWith(month + '-')) counts.set(date, (counts.get(date) || 0) + 1);
  }
  return Array.from({ length: lastDay }, (_, index) => {
    const date = month + '-' + String(index + 1).padStart(2, '0');
    return { date, count: counts.get(date) || 0 };
  });
}

// Count dated activity, not the date on which a user later checked attendance.
export function dailyStageActivity(leads, stage, month, today, range = null) {
  const days = dailyLeadCounts([], month, today).map(day => ({ ...day, completed: 0, unconfirmed: 0, entries: [] }));
  const byDate = new Map(days.map(day => [day.date, day]));
  for (const lead of leads || []) {
    const events = new Map();
    if (stage === 'marketing') {
      events.set(String(lead.createdAt || '').slice(0, 10), true);
    } else if (stage === 'contract') {
      if (lead.status !== '계약 완료') continue;
      events.set(String(lead.contractAt || '').slice(0, 10), true);
    } else if (stage === 'pre') {
      const meetings = Array.isArray(lead.crmMeetings) && lead.crmMeetings.length
        ? lead.crmMeetings : lead.crmMeeting ? [lead.crmMeeting] : [];
      for (const meeting of meetings) {
        if (Number(meeting?.type) !== 1 || !meeting.startAt) continue;
        const raw = String(meeting.startAt);
        const parsed = new Date(/[T ]/.test(raw) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw.replace(' ', 'T') + '+09:00' : raw);
        const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw
          : Number.isNaN(parsed.getTime()) ? '' : new Date(parsed.getTime() + 9 * 3600000).toISOString().slice(0, 10);
        if (!date) continue;
        // Multiple calendar entries for one company on one day count as one visit.
        events.set(date, events.get(date) === true || Number(meeting.checked) === 1);
      }
      if (!events.size) {
        const doneDate = String(lead.premeetingDoneAt || '').slice(0, 10);
        const meetingDate = String(lead.premeetingAt || lead.bookedAt || '').slice(0, 10);
        const completed = !!doneDate || ['프리미팅 완료', '견적·제안 발송', '계약 완료'].includes(lead.status);
        if (doneDate || meetingDate) events.set(doneDate || meetingDate, completed);
      }
    }
    for (const [date, completed] of events) {
      const day = byDate.get(date);
      if (!day || !inRange(date, range)) continue;
      day.entries.push({ lead, completed });
      day.count += 1;
      if (completed) day.completed += 1;
      else day.unconfirmed += 1;
    }
  }
  return days;
}
