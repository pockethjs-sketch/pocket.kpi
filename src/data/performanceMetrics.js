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
