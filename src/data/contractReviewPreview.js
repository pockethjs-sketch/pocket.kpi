import { _crmSyncDate, _crmSyncPaymentPercent } from '../../scripts/contract-sheet-sync-core.mjs';

// Explicitly approved creation only; never use a contract date as a receipt date.
export function contractReviewPreview(item) {
  const rows = item?.sourceRows || [];
  const dates = [...new Set(rows.map(r => r.date))];
  let reason = '';
  if (!rows.length) reason = '원본 계약 행이 없습니다';
  else if (item.company && !/^[a-f0-9]{64}$/i.test(item.sourceHash || '')) reason = '원본 해시 확인이 필요합니다';
  else if (/[\/·,]/.test(item.company || '')) reason = '복합 업체명입니다 · 기존 업체 식별을 먼저 확인해주세요';
  else if (dates.some(d => _crmSyncDate(d) !== d)) reason = '원본 계약 날짜를 확인해주세요';
  else if (dates.length !== 1) reason = '서로 다른 날짜의 계약입니다 · 기존 계약에 합산하지 않고 프로젝트별 연결 검토가 필요합니다';
  else if (rows.some(r => !Number.isSafeInteger(Number(r.amount)) || Number(r.amount) <= 0 || !r.dealText)) reason = '계약 금액·프로젝트를 확인해주세요';
  const signatures = rows.map(r => JSON.stringify([r.date,r.dealText,r.amount,r.ctype]));
  if (signatures.some((s,i) => signatures.indexOf(s) !== i)) reason = '중복 원본 행 확인이 필요합니다';
  let confirmedPaid = 0, paymentNotCompared = 0;
  for (const row of rows) {
    const percent = _crmSyncPaymentPercent(row.paymentText);
    const explicit = Number(row.paymentAmount || 0);
    const amount = percent === null ? explicit : Math.round(Number(row.amount || 0) * percent / 100);
    if (percent === null && !explicit) paymentNotCompared++;
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > Number(row.amount || 0)) reason = '확인 입금액이 계약 금액과 충돌합니다';
    else confirmedPaid += amount;
  }
  const contractAmount = rows.reduce((sum,r) => sum + Number(r.amount || 0),0);
  if (!Number.isSafeInteger(contractAmount) || !Number.isSafeInteger(confirmedPaid)) reason = '금액 범위를 확인해주세요';
  return { canAdd:!reason,reason,contractAmount,confirmedPaid,paymentNotCompared };
}
