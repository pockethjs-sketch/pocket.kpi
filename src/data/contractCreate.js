export function boundedContractOperation(operation, timeoutMs=45000, code='contract_operation_timeout') {
  let timer;
  return Promise.race([Promise.resolve(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),timeoutMs);})]).finally(()=>clearTimeout(timer));
}
export function contractCreateError(code) {
  const known={contract_operation_timeout:'응답 시간이 초과됐습니다. 저장 여부가 미확인인 상태이므로 반복 생성하지 말고 시트를 다시 대조해주세요.',
    remote_save_timeout:'기존 입력의 저장 확인이 지연됐습니다. 입력은 보존했습니다.',
    contract_source_changed:'원본이 변경됐습니다. 시트를 다시 대조한 뒤 승인해주세요.',
    contract_candidate_changed:'기존 계약 또는 연결 후보가 바뀌었습니다. 시트를 다시 대조해주세요.',
    contract_already_exists:'같은 계약이 이미 저장돼 있습니다. 중복 생성하지 말고 시트를 다시 대조해주세요.',
    revision_conflict:'다른 저장과 겹쳤습니다. 원본·DB를 다시 대조한 뒤 재시도해주세요.',
    contract_create_not_deployed:'계약 생성 서버 버전을 확인할 수 없습니다. 최신 화면을 다시 불러와 주세요.',
    contract_created_refresh_failed:'서버 저장은 완료됐으나 화면 갱신을 확인하지 못했습니다. 다시 생성하지 말고 시트를 다시 대조해주세요.',
    contract_created_verification_failed:'서버 저장값 대조가 일치하지 않습니다. 다시 생성하지 말고 확인해주세요.',
    contract_source_held:'원본 중복·금액·기존 계약 연결 확인이 필요해 생성하지 않았습니다.',
    contract_create_busy:'다른 저장이 처리 중입니다. 잠시 후 시트를 다시 대조해주세요.'};
  return known[code]||('계약 생성 실패 · '+(/^[a-z_0-9]+$/.test(String(code))?code:'request_failed')+' · 기존 입력은 보존했습니다.');
}
export function verifyCreatedContract(result,state,expected) {
  const lead=state?.leads?.find(l=>l.id===result?.leadId);
  const payments=lead?.payments||[];
  const paid=payments.reduce((s,p)=>s+(p.paidConfirmed||p.paidAt?Number(p.amount||0):0),0);
  if(Object.hasOwn(expected,'actualPaidAt')&&payments.some(p=>(p.paidConfirmed||p.paidAt)&&String(p.paidAt||'')!==expected.actualPaidAt))throw Error('contract_created_verification_failed');
  if(!result?.ok||!result.verified||!lead||lead.archivedAt||lead.archived_at||
    lead.contractSheetContractKey!==expected.contractKey||Number(lead.contractAmount)!==expected.contractAmount||
    Number(lead.paid)!==expected.confirmedPaid||paid!==expected.confirmedPaid||
    payments.reduce((s,p)=>s+Number(p.amount||0),0)!==expected.contractAmount||
    payments.filter(p=>p.paidConfirmed).length!==(expected.confirmedPaid>0?1:0)||
    lead.ctype!==expected.customerType||String(lead.contractSheetSourceCustomerType||'')!==String(expected.sourceCustomerType||'')||lead.contractSheetCreationMode!==expected.creationMode||
    String(lead.contractCompanyLeadId||'')!==expected.parentId||!lead.contractSheetScopedCreate)throw Error('contract_created_verification_failed');
  return lead;
}
// A committed contract must not later be overwritten by a stale failed creation.
// Preserve the complete journal, but keep overlapping entries out of automatic replay.
export function quarantineContractJournal(entries,leadId) {
  return (entries||[]).map(entry=>{
    const c=entry.mutation?.collections||{};
    const touches=(c.leads?.upsert||[]).some(x=>x.id===leadId)||(c.leads?.patches||[]).some(x=>x.id===leadId)||
      (c.leads?.remove||[]).includes(leadId);
    return touches?{...entry,blockedByConfirmedContract:leadId,blockedCode:'contract_scoped_recreate_blocked'}:entry;
  });
}
