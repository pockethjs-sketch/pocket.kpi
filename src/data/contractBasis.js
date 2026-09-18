const inRange = (date, range) => !!date && (!range || (date >= range[0] && date <= range[1]));
const dateKey = raw => {
  if (!raw) return '';
  const text = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(text + 'T00:00:00Z');
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : '';
  }
  const parsed = new Date(/[T ]/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text.replace(' ', 'T') + '+09:00' : text);
  return Number.isNaN(parsed.getTime()) ? '' : new Date(parsed.getTime() + 9 * 3600000).toISOString().slice(0, 10);
};
export const contractAmount = lead => Number(lead.contractAmount) || (lead.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

export function contractMeetingDate(lead) {
  const calendar = (lead.crmMeetings?.length ? lead.crmMeetings : lead.crmMeeting ? [lead.crmMeeting] : [])
    .filter(m => Number(m.type) === 1).map(m => dateKey(m.startAt)).filter(Boolean);
  // One contract belongs to one meeting month, even if there are repeat visits.
  if (calendar.length) return calendar.sort()[0];
  return dateKey(lead.premeetingDoneAt || lead.premeetingAt || lead.bookedAt);
}

export function contractBasisEvents(leads, basis) {
  const events = [];
  const undated = [];
  for (const lead of leads || []) {
    if (basis === 'meeting') {
      if (lead.status !== '계약 완료' || contractAmount(lead) <= 0) continue;
      const date = contractMeetingDate(lead);
      const event = { lead, date, amount: contractAmount(lead) };
      (date ? events : undated).push(event);
    } else {
      const payments = lead.payments || [];
      for (const payment of payments) {
        const amount = payment.crmManaged ? Number(payment.depositAmount) || 0
          : payment.paidAt || payment.paidConfirmed ? Number(payment.amount) || 0 : 0;
        if (amount <= 0) continue;
        const date = dateKey(payment.crmManaged ? payment.depositAt || payment.paidAt : payment.paidAt);
        const event = { lead, payment, date, amount };
        (date ? events : undated).push(event);
      }
      if (!payments.length && Number(lead.paid) > 0) undated.push({ lead, date: '', amount: Number(lead.paid) });
    }
  }
  return { events, undated };
}

export function summarizeContractBasis(leads, basis, range, customerType = '전체') {
  const source = contractBasisEvents(leads.filter(l => customerType === '전체' || (l.ctype || '신규') === customerType), basis);
  const events = source.events.filter(event => inRange(event.date, range));
  const byLead = new Map();
  for (const event of events) {
    const row = byLead.get(event.lead.id) || { ...event.lead, basisAmount: 0, basisDate: '', basisEvents: [] };
    row.basisAmount += event.amount;
    row.basisDate = event.date > row.basisDate ? event.date : row.basisDate;
    row.basisEvents.push(event);
    byLead.set(event.lead.id, row);
  }
  return { rows: [...byLead.values()].sort((a, b) => b.basisDate.localeCompare(a.basisDate)), events, undated: source.undated, total: events.reduce((sum, event) => sum + event.amount, 0) };
}
