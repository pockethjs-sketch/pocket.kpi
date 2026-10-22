import { _crmSyncAliases, _crmSyncDate } from '../../scripts/contract-sheet-sync-core.mjs';

const normalize = value => String(value || '').toLowerCase().replace(/\s+/g, '');
const alive = lead => !lead.archivedAt && !lead.archived_at && !lead.deletedAt;
const contractIdentity = row => JSON.stringify([_crmSyncAliases(row.company)[0] || normalize(row.company), row.date, normalize(row.dealText)]);
const projectNames = lead => [...(lead.lineItems || []).map(x => x.name), lead.crmProject?.name].filter(Boolean).map(normalize);
export const reviewLeadId = item => 'contract-sheet-' + String(item.contractKey || item.sourceHash).slice(0, 40);
export function contractReviewErrorText(code) {
  if (code === 'primary_not_ready') return '서버 데이터 로드 중입니다. 로드 후 다시 대조해주세요.';
  if (code === 'remote_save_timeout') return '변경사항 저장 확인이 지연됐습니다. 미등록 0건이 아닙니다.';
  if (code === 'contract_state_revision_busy') return '서버 데이터가 변경 중입니다. 다시 대조해주세요.';
  if (code === 'contract_review_not_deployed') return '계약별 시트 조회 API 버전이 아직 반영되지 않았습니다.';
  if (code === 'login_required' || code === 'invalid_session') return '직원 로그인 확인이 필요합니다.';
  if (code === 'AbortError') return '시트 또는 서버 조회 시간이 초과됐습니다. 다시 대조해주세요.';
  if (String(code).startsWith('sheet_')) return '시트 원본 검증 실패 · ' + code;
  return '시트 대조 요청 실패 · ' + (/^[a-z_0-9]+$/.test(code) ? code : 'request_failed');
}

export async function buildContractReviewItems(report, state, { hash = async value => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
} } = {}) {
  if (report?.schemaVersion !== 'contract-review-source-v1' || !report.ok || !Array.isArray(report.rows) ||
      report.rangeRows !== report.rows.length || !/^[a-f0-9]{64}$/.test(report.sourceHash || '') ||
      !Array.isArray(state?.leads)) throw Error('contract_review_not_deployed');
  const fetched = Date.parse(report.fetchedAt);
  if (!Number.isFinite(fetched) || Date.now() - fetched > 30 * 60000 || fetched > Date.now() + 60000) throw Error('sheet_review_stale');
  const all = state.leads, leads = all.filter(alive), items = [];
  let represented = 0, excluded = 0;
  const identities = report.rows.map(contractIdentity);
  for (let index = 0; index < report.rows.length; index++) {
    const row = report.rows[index], aliases = _crmSyncAliases(row.company);
    const contractKey = await hash(identities[index]);
    const sourceHash = await hash(JSON.stringify([contractKey,row.amount,row.paymentPercent,row.paymentAmount,row.owner,row.ctype]));
    const companyMatches = leads.filter(l => _crmSyncAliases(l.company).some(a => aliases.includes(a)));
    const direct = all.filter(l => l.contractSheetContractKey === contractKey || l.id === 'contract-sheet-' + contractKey.slice(0,40));
    const sourceDateRows = report.rows.filter(r => r.date === row.date && _crmSyncAliases(r.company).some(a => aliases.includes(a)));
    const dateMatches = companyMatches.filter(l => l.contractAt === row.date && Number(l.contractAmount) > 0);
    const exact = direct.length ? direct : dateMatches.filter(l => projectNames(l).includes(normalize(row.dealText)) ||
      (dateMatches.length === 1 && sourceDateRows.length === 1 && Number(l.contractAmount) === Number(row.amount)));
    const paid = lead => (lead.payments || []).length ? lead.payments.reduce((s,p) => s + (p.crmManaged ? Number(p.depositAmount || 0) : p.paidAt || p.paidConfirmed ? Number(p.amount || 0) : 0),0) : Number(lead.paid || 0);
    const expectedPaid = row.paymentPercent === null ? row.paymentAmount || null : Math.round(Number(row.amount) * row.paymentPercent / 100);
    const duplicate = identities.indexOf(identities[index]) !== identities.lastIndexOf(identities[index]);
    let reviewReason = '', matchType = companyMatches.length ? 'new_contract' : 'new';
    if (!aliases.length) reviewReason = '복합 업체명 · 회사 식별 확인이 필요합니다';
    else if (_crmSyncDate(row.date) !== row.date || !row.dealText || !Number.isSafeInteger(row.amount) || row.amount <= 0) reviewReason = '원본 날짜·프로젝트·금액 확인이 필요합니다';
    else if (duplicate) reviewReason = '같은 회사·날짜·프로젝트의 원본이 여러 행입니다 · 중복/회차 확인 필요';
    else if (exact.length > 1) reviewReason = '동일 계약 후보가 여러 건입니다 · 자동 연결하지 않습니다';
    else if (exact.length === 1) {
      const l = exact[0];
      if (!alive(l)) reviewReason = '보관/삭제된 계약과 일치합니다 · 자동 재생성하지 않습니다';
      else if (Number(l.contractAmount) !== Number(row.amount) || (expectedPaid !== null && paid(l) !== expectedPaid)) reviewReason = '기존 계약의 계약액/확인 입금액 차이 · 새 계약으로 중복 생성하지 않습니다';
      else { represented++; continue; }
      matchType = 'existing_contract_difference';
    } else if (dateMatches.length) {
      reviewReason = '같은 날짜의 기존 계약이 있습니다 · 프로젝트/금액 연결 확인 필요';
      matchType = 'existing_contract_difference';
    }
    const ignored = (state.contractStatusLogs || []).some(log => log.action === '외부 시트 제외' && log.meta?.sourceKey === contractKey && log.meta?.sourceHash === sourceHash);
    if (ignored) { excluded++; continue; }
    const candidates = companyMatches.map(l => ({id:l.id,company:l.company,contractAt:l.contractAt || '',contractAmount:Number(l.contractAmount || 0)}));
    items.push({ id:'contract-review-' + contractKey + (duplicate ? '-row-' + row.row : ''), contractKey, sourceKey:contractKey, sourceHash,
      company:row.company, firstDate:row.date, lastDate:row.date, sourceRows:[row], sourceAmount:row.amount,
      ctype:row.ctype, owner:row.owner, services:[row.service].filter(Boolean), matchType, candidates,
      targetId:candidates.length === 1 ? candidates[0].id : '', reviewReason,
      changeType:matchType === 'new_contract' ? '기존 업체의 미등록 계약' : matchType === 'new' ? '신규 업체 생성' : '기존 계약 대조 필요' });
  }
  items.sort((a,b) => b.firstDate.localeCompare(a.firstDate) || a.company.localeCompare(b.company,'ko'));
  return {ok:true,action:'contract_changes',schemaVersion:'contract-review-v2',sourceCutoff:report.start,
    sourceSpreadsheetId:'1vNlj417n1JE0HTOky5FCKS0_Y5daeor7oIok3SXMbss',checkedAt:report.fetchedAt,sourceHash:report.sourceHash,
    comparedRows:report.rows.length,represented,excluded,pending:items.length,items};
}
