// Presentation only: never use display values to calculate receipts or create contracts.
export const CONTRACT_REVIEW_COLUMNS = [
  ['date','날짜',108],['company','업체명',174],['owner','프리',145],
  ['payment','대금 지급 확인',108],['project','프로젝트',180],
  ['price','별도가',125],['method','계약방식',170],['type','신규/기존',74],['action','추가 여부',108],
];
export function contractReviewSheetCells(item) {
  const rows = item.sourceRows || [], r = rows[0] || {};
  if (rows.length !== 1) return {date:item.firstDate || '확인 필요',company:item.company || '',owner:item.owner || '',payment:'개별 확인',project:'복수 원본 · 추가 설정에서 확인',price:'개별 확인',methods:[],methodStatus:'unknown',type:item.ctype || '',ownerTone:0};
  const percent = r.paymentPercent;
  const payment = typeof r.paymentDisplay === 'string' ? r.paymentDisplay :
    Number.isFinite(percent) && percent >= 0 && percent <= 100 ? (percent === 100 ? '✓' : percent + '%') : '확인 필요';
  const price = r.amountDisplay || (Number.isSafeInteger(r.netAmount) && r.netAmount > 0 ? String(r.netAmount / 10000) : 'amountDisplay' in r ? '확인 필요' : '미제공');
  const owner = r.owner || item.owner || '';
  const ownerTone = [...owner].reduce((n,c) => (n + c.codePointAt(0)) % 4,0);
  return {date:r.date || item.firstDate || '확인 필요',company:r.company || item.company || '',owner,
    payment,project:r.dealText || '',price,methods:Array.isArray(r.contractMethods) ? r.contractMethods : [],
    methodStatus:r.contractMethodStatus || 'unavailable',type:r.ctype || '',ownerTone};
}
export function contractReviewSheetOrder(items) {
  return [...items].sort((a,b) => (a.sourceRows?.[0]?.row ?? Infinity) - (b.sourceRows?.[0]?.row ?? Infinity) || (a.firstDate || '').localeCompare(b.firstDate || ''));
}
