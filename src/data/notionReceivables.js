export function notionReceivableSummary(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    count: safeRows.length,
    missingCompany: safeRows.filter((row) => !String(row.company || '').trim()).length,
    requestDonePaymentOpen: safeRows.filter((row) => row.request_status === '완료' && row.payment_status === '입금전').length,
  };
}

export function filterNotionReceivables(rows, { query = '', requestStatus = '', paymentStatus = '' } = {}) {
  const keyword = query.trim().toLocaleLowerCase('ko-KR');
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (requestStatus && row.request_status !== requestStatus) return false;
    if (paymentStatus && row.payment_status !== paymentStatus) return false;
    if (!keyword) return true;
    return [row.company, row.projects_text, row.freelancer, row.notes]
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
