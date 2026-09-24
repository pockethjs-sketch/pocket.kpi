export function notionReceivableSummary(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    count: safeRows.length,
    missingCompany: safeRows.filter((row) => !String(row.company || '').trim()).length,
    requestDonePaymentOpen: safeRows.filter((row) => row.request_status === '완료' && row.payment_status === '입금전').length,
  };
}

export const NOTION_RECEIVABLE_STAGES = [
  { id: 'requestBefore', label: '지급요청 전' },
  { id: 'requestOngoing', label: '요청 진행' },
  { id: 'awaitingPayment', label: '입금 대기' },
  { id: 'paid', label: '입금 완료' },
  { id: 'review', label: '상태 확인' },
];

export function notionReceivableStage(row) {
  const payment = String(row?.payment_status || '').trim();
  const request = String(row?.request_status || '').trim();
  if (payment === '입금완료' || payment === '카결완료') return 'paid';
  if (payment !== '입금전') return 'review';
  if (request === '완료') return 'awaitingPayment';
  if (/^지급요청[1-3]$/.test(request)) return 'requestOngoing';
  if (request === '지급요청 전') return 'requestBefore';
  return 'review';
}

export function notionReceivableStageCounts(rows) {
  const counts = Object.fromEntries(NOTION_RECEIVABLE_STAGES.map(({ id }) => [id, 0]));
  for (const row of Array.isArray(rows) ? rows : []) counts[notionReceivableStage(row)] += 1;
  return counts;
}

export function filterNotionReceivables(rows, { query = '', requestStatus = '', paymentStatus = '', stage = '' } = {}) {
  const keyword = query.trim().toLocaleLowerCase('ko-KR');
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (stage && notionReceivableStage(row) !== stage) return false;
    if (requestStatus && row.request_status !== requestStatus) return false;
    if (paymentStatus && row.payment_status !== paymentStatus) return false;
    if (!keyword) return true;
    return [row.company, row.projects_text, row.freelancer, row.notes, row.deposit_text, row.balance_text]
      .some((value) => String(value || '').toLocaleLowerCase('ko-KR').includes(keyword));
  });
}

export function notionSourceUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !['app.notion.com', 'www.notion.so', 'notion.so'].includes(url.hostname)) return '';
    return url.href;
  } catch {
    return '';
  }
}
