const inRange = (date, range) => !range || (!!date && date >= range[0] && date <= range[1]);

// Reconstruct dated totals from current records; these are not historical snapshots.
export function dailyComparisonWindow(range, today, dayMode = false) {
  const end = range && range[1] < today ? range[1] : today;
  const start = range?.[0] || '0001-01-01';
  if (start > end) return null;
  const previous = new Date(end + 'T00:00:00Z');
  previous.setUTCDate(previous.getUTCDate() - 1);
  const before = previous.toISOString().slice(0, 10);
  return { current: [start, end], previous: dayMode ? [before, before] : [start, before], end, before };
}

export function relativeMetricChange(current, previous) {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return { text: '비교 불가', direction: 0 };
  if (current === previous) return { text: '— 0%', direction: 0 };
  if (previous === 0) return { text: '신규 발생', direction: 1 };
  const percent = (current - previous) / Math.abs(previous) * 100;
  const magnitude = Math.abs(percent);
  return { text: `${percent > 0 ? '▲' : '▼'} ${magnitude < 0.1 ? '<0.1' : Number(magnitude.toFixed(1)).toLocaleString('ko-KR')}%`, direction: Math.sign(percent) };
}

export function absoluteCountChange(current, previous) {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return { text: '비교 불가', direction: 0 };
  const difference = current - previous;
  return { text: (difference > 0 ? '+' : difference < 0 ? '−' : '') + Math.abs(difference).toLocaleString('ko-KR') + '건', direction: Math.sign(difference) };
}

export function previousMonthCostWindow(period, today) {
  if (period.mode !== 'month') return null;
  const month = `${period.y}-${String(period.m).padStart(2, '0')}`;
  if (month > today.slice(0, 7)) return null;
  const last = new Date(Date.UTC(period.y, period.m, 0)).getUTCDate();
  const day = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : last;
  const prevLast = new Date(Date.UTC(period.y, period.m - 1, 0));
  const previousMonth = prevLast.toISOString().slice(0, 7);
  const fullMonth = day === last;
  const previousDay = fullMonth ? prevLast.getUTCDate() : Math.min(day, prevLast.getUTCDate());
  return {
    current: [month + '-01', month + '-' + String(day).padStart(2, '0')],
    previous: [previousMonth + '-01', previousMonth + '-' + String(previousDay).padStart(2, '0')],
    previousMonth, fullMonth,
  };
}

export function completeDatedSpend(adDaily, range) {
  if (!range || range[0] > range[1]) return null;
  let total = 0;
  for (const key of ['META', 'NAVER', 'GOOGLE']) {
    const rows = new Map();
    for (const row of adDaily?.[key] || []) {
      if (!inRange(row.date, range)) continue;
      if (rows.has(row.date) || row.spend == null || !Number.isFinite(Number(row.spend)) || Number(row.spend) < 0) return null;
      rows.set(row.date, Number(row.spend));
    }
    for (let day = new Date(range[0] + 'T00:00:00Z'); day.toISOString().slice(0, 10) <= range[1]; day.setUTCDate(day.getUTCDate() + 1)) {
      const value = rows.get(day.toISOString().slice(0, 10));
      if (value == null) return null;
      total += value;
    }
  }
  return total;
}

// Only compare money when dated rows reconcile with the displayed monthly total.
// Never estimate daily spend by dividing a monthly budget by days.
export function previousDatedSpend(adDaily, window, displayedSpend) {
  if (!window || displayedSpend == null) return null;
  const rows = ['META', 'NAVER', 'GOOGLE'].flatMap(key => adDaily?.[key] || []);
  const current = rows.filter(row => inRange(row.date, window.current) && row.spend != null && Number.isFinite(Number(row.spend)));
  if (!current.length) return null;
  const total = current.reduce((sum, row) => sum + Number(row.spend), 0);
  if (Math.abs(total - displayedSpend) > 1) return null;
  // A once-daily collector normally ends at D-1. Older data is not a valid daily comparison.
  if (['META', 'NAVER', 'GOOGLE'].some(key => {
    const dates = (adDaily?.[key] || []).filter(row => row.spend != null && Number.isFinite(Number(row.spend)) && row.date <= window.end).map(row => row.date).sort();
    return !dates.length || dates[dates.length - 1] < window.before;
  })) return null;
  if (window.previous[0] > window.previous[1]) return 0;
  return rows.filter(row => inRange(row.date, window.previous)).reduce((sum, row) => sum + (Number(row.spend) || 0), 0);
}

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

// Display-only filter: keep underlying activity and monthly KPI totals intact.
export function weekdayActivity(days) {
  return (days || []).filter(day => {
    const weekday = new Date(day.date + 'T00:00:00Z').getUTCDay();
    return weekday >= 1 && weekday <= 5;
  });
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
