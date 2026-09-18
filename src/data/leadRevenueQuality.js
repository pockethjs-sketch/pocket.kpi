// Display-only segmentation of CRM inquiry answers, independent of TM scores.
export const REVENUE_GROUPS = [
  { key: 'early', label: '매출없음 / 예비 / 서비스 제작단계' },
  { key: 'one', label: '매출 1억 이상' },
  { key: 'ten', label: '매출 10억 이상' },
];

export function revenueAnswer(lead) {
  const sheet = lead?.crmSheet || {};
  const values = lead?.crmQuality?.values || {};
  const candidates = [sheet.annualSalesRaw, values.annua_sales_structured, sheet.annualSales, values.annua_sales];
  return String(candidates.find(value => value != null && String(value).trim() && !/^[-—]$/.test(String(value).trim())) ?? '').trim();
}

export function classifyRevenueAnswer(answer) {
  const value = String(answer ?? '').normalize('NFKC').replace(/[\s_,]/g, '').replace(/[～–−]/g, '~');
  if (!value || /^(?:-|—|미정|미입력|미확인|undefined|null)$/.test(value)) return 'missing';
  if (/^(?:없음|매출없음|매출이없음|매출없다|무매출|매출미발생|매출발생전|0(?:원|만원|억|억원)?)$/.test(value)
      || /^(?:예비(?:창업자)?|(?:제품|서비스|제품\/서비스)(?:제작|개발|준비)단계)$/.test(value)) return 'early';
  // No extrapolation from monthly sales, free text or unspecified revenue.
  const amount = value.replace(/^(?:연간|연)?매출/, '').replace(/^발생매출/, '');
  const range = amount.match(/^(\d+(?:\.\d+)?)(?:억)?[~\-](\d+(?:\.\d+)?)억(?:원)?$/);
  if (range) {
    const low = Number(range[1]), high = Number(range[2]);
    if (low > high) return 'uncertain';
    if (low >= 10) return 'ten';
    if (low >= 1 && high < 10) return 'one';
    return 'uncertain';
  }
  const explicit = amount.match(/^(\d+(?:\.\d+)?)(억원?|만원|원)(이상|초과|미만|이하)?$/);
  if (!explicit || /미만|이하/.test(explicit[3] || '')) return 'uncertain';
  const number = Number(explicit[1]) * (/^억/.test(explicit[2]) ? 1e8 : explicit[2] === '만원' ? 1e4 : 1);
  if (number >= 1e9) return 'ten';
  if (number >= 1e8) return 'one';
  if (number === 0 && !explicit[3]) return 'early';
  return 'uncertain';
}

export function summarizeRevenueQuality(leads = []) {
  const counts = { early: 0, one: 0, ten: 0, missing: 0, uncertain: 0 };
  const unresolved = new Map();
  for (const lead of leads) {
    const answer = revenueAnswer(lead);
    const key = classifyRevenueAnswer(answer);
    counts[key] += 1;
    if (key === 'uncertain') unresolved.set(answer, (unresolved.get(answer) || 0) + 1);
  }
  return { ...counts, total: leads.length, unresolved: [...unresolved].map(([label, count]) => ({ label, count })) };
}
