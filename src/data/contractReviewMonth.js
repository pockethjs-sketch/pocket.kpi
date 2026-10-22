const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
const dateMonth = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value.slice(0, 7) : '';
};
const itemMonths = item => [...new Set((item.sourceRows?.length ? item.sourceRows.map(row => row.date) : [item.firstDate]).map(date => dateMonth(date) || 'unknown'))];

export function defaultContractReviewMonth(period, today) {
  const month = ['month', 'day'].includes(period?.mode) ? `${period.y}-${String(period.m).padStart(2, '0')}` : '';
  return validMonth(month) ? month : dateMonth(today) || 'all';
}

export const contractReviewMonthLabel = month => month === 'all' ? '전체 기간' : month === 'unknown' ? '날짜 확인 필요' : `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;

export function filterContractReviewMonth(items, month) {
  return items.filter(item => month === 'all' || itemMonths(item).includes(month));
}

export function contractReviewMonthOptions(items, { start, today, selected }) {
  const months = new Set(items.flatMap(itemMonths));
  const first = dateMonth(start), last = dateMonth(today);
  if (first && last && first <= last) {
    let year = Number(first.slice(0, 4)), month = Number(first.slice(5));
    while (`${year}-${String(month).padStart(2, '0')}` <= last) {
      months.add(`${year}-${String(month).padStart(2, '0')}`);
      if (++month === 13) { year++; month = 1; }
    }
  }
  if (validMonth(selected) || selected === 'unknown') months.add(selected);
  return [{ value: 'all', label: `전체 기간 · ${items.length}건` }, ...[...months].filter(validMonth).sort().reverse().map(value => ({
    value, label: `${contractReviewMonthLabel(value)} · ${filterContractReviewMonth(items, value).length}건`,
  })), ...(months.has('unknown') ? [{ value: 'unknown', label: `날짜 확인 필요 · ${filterContractReviewMonth(items, 'unknown').length}건` }] : [])];
}
