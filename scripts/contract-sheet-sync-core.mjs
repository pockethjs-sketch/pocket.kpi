// Pure source parser/planner. Bundled into Code.gs by build-contract-sync.mjs.
// No I/O, fuzzy matching, or user-data deletion. Produces guarded atomic patches.
export function _crmSyncName(value) {
  return String(value || '').toLowerCase().replace(/\(주\)|㈜|주식회사|유한회사/g, '').replace(/[^a-z0-9가-힣]/g, '');
}
export function _crmSyncAliases(value) {
  var raw = String(value || '').replace(/\(주\)|㈜/g, ''), parts = [raw], m;
  // Compound company names are ambiguous. Do not guess which company owns a contract.
  if (/[\/·,]/.test(raw)) return [];
  parts.push(raw.replace(/\([^)]*\)/g, ''));
  var re = /\(([^)]+)\)/g;
  while ((m = re.exec(raw))) if (!/대표|담당|이사|팀장/.test(m[1])) parts.push(m[1]);
  return parts.map(_crmSyncName).filter(function (x, i, a) { return x.length >= 2 && a.indexOf(x) === i; });
}
export function _crmSyncDate(value) {
  var m = String(value || '').trim().match(/^(\d{2}|\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})$/);
  if (!m) return '';
  var y = Number(m[1]) + (m[1].length === 2 ? 2000 : 0), month = Number(m[2]), day = Number(m[3]);
  var d = new Date(Date.UTC(y, month - 1, day));
  return d.getUTCFullYear() === y && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.toISOString().slice(0, 10) : '';
}
export function _crmSyncMoney(value) {
  var raw = String(value == null ? '' : value).trim(), text = raw.replace(/,/g, ''), included = /포함가|부가세\s*포함|VAT\s*포함/i.test(text);
  text = text.replace(/\((?:포함가|부가세\s*포함|VAT\s*포함)\)/ig, '').trim();
  var m = text.match(/^(\d+(?:\.\d+)?)\s*(만원|만|원)?$/);
  if (!m || Number(m[1]) <= 0) return { amount: null, netAmount: null, amountRaw: raw, taxBasis: '확인 필요' };
  var n = Number(m[1]) * (m[2] === '원' ? 1 : 10000);
  if (!Number.isSafeInteger(Math.round(n))) return { amount: null, netAmount: null, amountRaw: raw, taxBasis: '확인 필요' };
  return { amount: Math.round(n * (included ? 1 : 1.1)), netAmount: included ? null : Math.round(n), amountRaw: raw, taxBasis: included ? '포함가 명시' : '별도가 × 1.1' };
}
export function _crmSyncService(text) {
  if (/투자|투A|투B|자금유치|IR|팁스/i.test(text)) return '투자유치';
  if (/지원|예비창업|초기창업|B2G|정A/i.test(text)) return '지원사업 관리';
  if (/개발|IT서비스|AX/i.test(text)) return 'AX 개발';
  if (/브랜딩|브랜드|로고/i.test(text)) return '브랜딩 관리';
  if (/포켓비즈|멤버십/i.test(text)) return '포켓비즈';
  return '';
}
// Parse displayed H-column values (getDisplayValues preserves numeric percentage formatting).
// A bare number or a note containing a check is not proof of payment.
export function _crmSyncPaymentPercent(value) {
  var text = String(value == null ? '' : value).trim().replace(/\uFE0F/g, '');
  if (/^(?:v|✓|✔|☑|✅|true|입금\s*완료|지급\s*완료)$/i.test(text)) return 100;
  var m = text.match(/^(\d+(?:\.\d+)?)\s*[%％]$/);
  return m && Number(m[1]) >= 0 && Number(m[1]) <= 100 ? Number(m[1]) : null;
}
export function _crmPaymentScheduleHash(payments, hash) {
  return hash(JSON.stringify(payments.map(function (p) {
    return [String(p.id), Number(p.amount), !!(p.paidAt || p.paidConfirmed), !!p.crmManaged, Number(p.depositAmount || 0)];
  })));
}
export function _crmParseContractSource(values, hash, cutoff) {
  if (!Array.isArray(values) || values.length < 1) throw new Error('contract_source_empty');
  var headers = values[0].map(function (h) { return String(h || '').replace(/\s/g, ''); });
  var required = ['날짜', '업체명', '프리', '프로젝트', '별도가', '비고', '신규/기존', '대금지급확인'];
  var ix = {};
  required.forEach(function (h) {
    if (headers.filter(function (x) { return x === h; }).length !== 1) throw new Error('contract_source_header:' + h);
    ix[h] = headers.indexOf(h);
  });
  var groups = {}, context = null;
  values.slice(1).forEach(function (v, i) {
    var cell = function (name) { return String(v[ix[name]] == null ? '' : v[ix[name]]).trim(); };
    var company = cell('업체명'), project = cell('프로젝트');
    if (company) context = { company: company, date: _crmSyncDate(cell('날짜')), owner: cell('프리'), ctype: cell('신규/기존') };
    // Never inherit another company's type, owner or invalid date.
    else if (!project && !cell('별도가')) { context = null; return; }
    if (!context) return;
    var date = cell('날짜') ? _crmSyncDate(cell('날짜')) : context.date;
    if (!date || date < cutoff) return;
    company = company || context.company;
    var money = _crmSyncMoney(cell('별도가'));
    var owner = cell('프리') || context.owner;
    owner = /^정.*대표/.test(owner) ? '정규진' : /^이.*이사/.test(owner) ? '이현성' : /^장.*팀장/.test(owner) ? '장혁' : owner.replace(/대표님|이사님|팀장님/g, '').trim();
    var payment = cell('대금지급확인'), paidMatch = payment.replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*(만원|만|원)(?:\s*(선입금|입금))?$/);
    var row = { row: i + 2, date: date, company: company, owner: owner, ownerRaw: cell('프리') || context.owner,
      dealText: project, memo: cell('비고'), ctype: cell('신규/기존') || context.ctype,
      amount: money.amount, netAmount: money.netAmount, amountRaw: money.amountRaw, taxBasis: money.taxBasis,
      service: _crmSyncService(project), paymentText: payment, paymentPercent: _crmSyncPaymentPercent(payment), paymentChecked: _crmSyncPaymentPercent(payment) > 0,
      paymentAmount: paidMatch ? Math.round(Number(paidMatch[1]) * (paidMatch[2] === '원' ? 1 : 10000)) : 0 };
    var key = _crmSyncName(company);
    if (!key) return;
    if (!groups[key]) groups[key] = { sourceKey: key, company: company, aliases: _crmSyncAliases(company), rows: [] };
    groups[key].rows.push(row);
  });
  return Object.keys(groups).map(function (key) {
    var g = groups[key];
    g.rows.sort(function (a, b) { return a.date.localeCompare(b.date) || a.row - b.row; });
    g.sourceHash = hash(JSON.stringify(g.rows));
    g.changeId = 'contract-' + g.sourceHash.slice(0, 24);
    g.amountKnown = g.rows.every(function (r) { return r.amount !== null && !!r.dealText; });
    var rowKeys = g.rows.map(function (r) { return JSON.stringify([r.date, r.dealText, r.amount, r.memo, r.ctype]); });
    g.duplicateRows = rowKeys.some(function (key, i) { return rowKeys.indexOf(key) !== i; });
    g.amount = g.amountKnown ? g.rows.reduce(function (n, r) { return n + r.amount; }, 0) : 0;
    g.numericPaid = g.rows.reduce(function (n, r) { return n + r.paymentAmount; }, 0);
    g.paymentChecked = g.rows.some(function (r) { return r.paymentChecked; });
    g.services = g.rows.map(function (r) { return r.service; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    g.ctype = g.rows.every(function (r) { return r.ctype === '신규'; }) ? '신규' : g.rows[g.rows.length - 1].ctype;
    g.owner = g.rows[g.rows.length - 1].owner;
    g.firstDate = g.rows[0].date; g.lastDate = g.rows[g.rows.length - 1].date;
    // Row moves and payment checkboxes must not reapply contract values.
    g.syncHash = hash(JSON.stringify(g.rows.map(function (r) { return [r.company, r.date, r.dealText, r.memo, r.amount, r.taxBasis, r.ctype]; }).sort(function (a, b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); })));
    return g;
  });
}
export function _crmPlanContractAutoSync(groups, state, now, hash) {
  var patches = [], logs = [], updated = [], blocked = [], unchanged = 0;
  var today = new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10);
  var leads = (state.leads || []).filter(function (l) {
    return l && !l.archivedAt && !l.archived_at && ['프리미팅 확정', '프리미팅 완료', '견적·제안 발송', '계약 완료'].indexOf(l.status) >= 0 &&
      (!!l.premeetingAt || !!l.premeetingDoneAt || (l.crmMeetings || []).some(function (m) { return Number(m.type) === 1; }) || Number((l.crmMeeting || {}).type) === 1);
  });
  var claimed = {};
  groups.forEach(function (g) {
    if (!g.rows.every(function (r) { return r.ctype === '신규'; })) return;
    var candidates = leads.filter(function (l) { return _crmSyncAliases(l.company).some(function (a) { return g.aliases.indexOf(a) >= 0; }); });
    if (!candidates.length) return;
    var reject = function (reason) { blocked.push({ company: g.company, reason: reason, sourceKey: g.sourceKey }); };
    if (candidates.length !== 1) { reject('동일 이름의 프리미팅 기업이 여러 곳'); return; }
    var l = candidates[0], previous = l.contractSheetSync || {};
    if (l.ctype !== '신규') { reject('프리미팅 기업의 신규/기존 구분 불일치'); return; }
    if (previous.sourceKey && previous.sourceKey !== g.sourceKey) { reject('이미 다른 원본 업체와 연결됨'); return; }
    if (claimed[l.id]) { reject('복수 원본 업체가 같은 기업에 매칭됨'); return; }
    claimed[l.id] = g.sourceKey;
    if (previous.syncHash === g.syncHash) { unchanged += 1; return; }
    if (!g.amountKnown || g.amount <= 0) { reject('프로젝트 또는 계약금액 확인 필요'); return; }
    if (g.duplicateRows) { reject('동일 계약 행 중복 확인 필요'); return; }
    if (g.lastDate > today) { reject('미래 계약일'); return; }
    if (g.firstDate !== g.lastDate) { reject('서로 다른 계약일이 여러 건'); return; }
    if ((previous.sourceRows || []).length > g.rows.length) { reject('원본 계약 행 감소 · 삭제 전파 안 함'); return; }
    var paid = (l.payments || []).length ? l.payments.reduce(function (n, p) {
      return n + (p.crmManaged ? Number(p.depositAmount || 0) : (p.paidAt || p.paidConfirmed ? Number(p.amount || 0) : 0));
    }, 0) : Number(l.paid || 0);
    if (paid > g.amount) { reject('계약액이 기존 입금액보다 작음'); return; }
    if (g.rows.some(function (r) { return /추가|연장|월관리|매월|월운영/.test(r.memo + ' ' + r.dealText); }) && !previous.syncHash) { reject('추가·반복 계약 여부 확인 필요'); return; }
    var proposed = { contractAmount: g.amount, contractAt: g.firstDate, status: '계약 완료' };
    var conflicts = Object.keys(proposed).filter(function (key) {
      var value = l[key], last = (previous.applied || {})[key];
      if (JSON.stringify(value) === JSON.stringify(proposed[key])) return false;
      if (last !== undefined && JSON.stringify(value) === JSON.stringify(last)) return false;
      if (key === 'status') return ['프리미팅 확정', '프리미팅 완료', '견적·제안 발송'].indexOf(value) < 0;
      return value !== undefined && value !== null && value !== '' && value !== 0;
    });
    if (conflicts.length) { reject('기존 입력값 보존: ' + conflicts.join(', ')); return; }
    // Existing line items/payment plans are independent user input, not sheet rows to replace.
    var existingLines = (l.lineItems || []).filter(function (x) { return Number(x.price || 0) > 0; });
    if (existingLines.length && existingLines.reduce(function (n, x) { return n + Number(x.price); }, 0) !== g.amount) { reject('기존 상세 계약금액과 불일치'); return; }
    var details = g.rows.map(function (r) { return r.date + ' · ' + r.dealText + ' · 계약액 ' + r.amount.toLocaleString('en-US') + '원 (' + r.taxBasis + ')' + (r.memo ? '\n비고: ' + r.memo : ''); }).join('\n');
    var segment = '[계약 프로세스 자동연동]\n' + details;
    var memo = String(l.memo || '');
    if (previous.memoSegment && memo.indexOf(previous.memoSegment) >= 0) memo = memo.replace(previous.memoSegment, segment);
    else if (memo.indexOf(segment) < 0) memo = [memo, segment].filter(Boolean).join('\n\n');
    proposed.memo = memo;
    if (!l.buildup && g.services.length === 1) proposed.buildup = g.services[0];
    if (!(l.buildups || []).length && g.services.length) proposed.buildups = g.services;
    var before = {};
    Object.keys(proposed).forEach(function (key) { before[key] = l[key] === undefined ? null : l[key]; });
    proposed.contractSheetSync = { sourceKey: g.sourceKey, syncHash: g.syncHash, appliedAt: now,
      sourceRows: g.rows, applied: { contractAmount: g.amount, contractAt: g.firstDate, status: '계약 완료' }, memoSegment: segment };
    var ops = Object.keys(proposed).filter(function (key) { return JSON.stringify(l[key]) !== JSON.stringify(proposed[key]); }).map(function (key) { return { op: 'set', path: [key], value: proposed[key] }; });
    patches.push({ id: String(l.id), ops: ops });
    var after = {}; Object.keys(before).forEach(function (key) { after[key] = proposed[key]; });
    logs.push({ id: 'contract-auto-' + hash(String(l.id) + g.syncHash + now).slice(0, 32), at: now, date: today,
      company: l.company, leadId: l.id, action: '외부 시트 자동 반영', source: '계약 프로세스 시트', actor: '시스템',
      detail: '신규 계약 자동 반영 · 계약액 ' + g.amount.toLocaleString('en-US') + '원 · 입금/잔금 보존',
      meta: { sourceKey: g.sourceKey, syncHash: g.syncHash, before: before, after: after } });
    updated.push({ id: l.id, company: l.company, contractAmount: g.amount });
  });
  // All matches must be one-to-one, including aliases across separate source groups.
  var counts = {};
  groups.filter(function (g) { return g.rows.every(function (r) { return r.ctype === '신규'; }); }).forEach(function (g) {
    leads.forEach(function (l) { if (_crmSyncAliases(l.company).some(function (a) { return g.aliases.indexOf(a) >= 0; })) counts[l.id] = (counts[l.id] || 0) + 1; });
  });
  patches = patches.filter(function (p) { return counts[p.id] === 1; });
  var ids = patches.map(function (p) { return p.id; });
  logs = logs.filter(function (l) { return ids.indexOf(String(l.leadId)) >= 0; });
  updated = updated.filter(function (l) { return ids.indexOf(String(l.id)) >= 0; });
  return { updated: updated, blocked: blocked, unchanged: unchanged, mutation: { origin: 'contract_sheet_sync', reason: 'new_contract_auto_sync',
    collections: { leads: { idField: 'id', patches: patches }, contractStatusLogs: { idField: 'id', upsert: logs } } } };
}

// H confirms a cumulative amount, not another receipt. Never invent collection dates,
// undo payments, guess among ambiguous installments, or alter CRM-owned schedules.
export function _crmPlanContractPaymentSync(groups, state, now, hash, options) {
  var sourceAuthoritative = !!(options && options.sourceAuthoritative);
  var patches = [], logs = [], updated = [], blocked = [], unchanged = 0;
  var today = new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10);
  var leads = (state.leads || []).filter(function (l) { return l && !l.archivedAt && !l.archived_at; });
  var sourceMatches = {};
  groups.filter(function (g) { return g.paymentChecked; }).forEach(function (g) {
    leads.forEach(function (l) {
      if (_crmSyncAliases(l.company).some(function (a) { return g.aliases.indexOf(a) >= 0; }))
        sourceMatches[l.id] = (sourceMatches[l.id] || 0) + 1;
    });
  });
  groups.forEach(function (g) {
    if (!g.paymentChecked) return;
    var candidates = leads.filter(function (l) { return _crmSyncAliases(l.company).some(function (a) { return g.aliases.indexOf(a) >= 0; }); });
    var reject = function (reason) { blocked.push({ company: g.company, sourceKey: g.sourceKey, reason: reason }); };
    if (candidates.length !== 1) { reject(candidates.length ? '동명이업체/별칭 중복' : '저장된 업체 없음'); return; }
    var l = candidates[0], row = g.rows[0];
    if (sourceMatches[l.id] !== 1) { reject('여러 원본 업체가 같은 DB 업체에 매칭됨'); return; }
    if (g.rows.length !== 1 || !row.paymentChecked || row.paymentAmount || !(_crmSyncPaymentPercent(row.paymentText) > 0)) {
      reject('복수 계약 또는 입금 표시 확인 필요'); return;
    }
    var payments = l.payments || [];
    var scheduleTotal = payments.reduce(function (n, p) { return n + Number(p.amount || 0); }, 0);
    var total = Number(l.contractAmount || 0) || scheduleTotal || Number(l.expected || 0);
    var eligible = l.status === '계약 완료' || (['프리미팅 확정', '프리미팅 완료', '견적·제안 발송'].indexOf(l.status) >= 0 &&
      (!!l.premeetingAt || !!l.premeetingDoneAt || Number((l.crmMeeting || {}).type) === 1 || (l.crmMeetings || []).some(function (m) { return Number(m.type) === 1; })));
    if (row.date > today || !g.amountKnown || g.amount <= 0 || total !== g.amount || !eligible) {
      reject('계약 상태·금액·날짜 불일치'); return;
    }
    if (l.contractSheetSync && l.contractSheetSync.sourceKey && l.contractSheetSync.sourceKey !== g.sourceKey) {
      reject('다른 계약 원본과 연결됨'); return;
    }
    if (payments.some(function (p) { return p.crmManaged || !Number.isSafeInteger(Number(p.amount)) || Number(p.amount) <= 0; }) ||
      (payments.length && scheduleTotal !== g.amount)) {
      reject('DB 결제 회차와 계약액 불일치'); return;
    }
    var percent = _crmSyncPaymentPercent(row.paymentText), target = Math.round(g.amount * percent / 100);
    var paid = payments.reduce(function (n, p) { return n + (p.paidAt || p.paidConfirmed ? Number(p.amount) : 0); }, 0);
    var previous = l.contractSheetPaymentSync;
    if (Number(l.paid || 0) > paid) { reject('별도 입금 기록과 결제 회차 불일치'); return; }
    if (target < paid) { reject('시트 입금액 감소 · 기존 입금 취소 안 함'); return; }
    if (target === paid) { unchanged += 1; return; }
    if (previous && (previous.sourceKey !== g.sourceKey || (!sourceAuthoritative && previous.scheduleHash && previous.scheduleHash !== _crmPaymentScheduleHash(payments, hash)))) {
      reject('이전 자동 반영 이후 수동 결제 수정 확인 필요'); return;
    }
    var paymentHash = hash(JSON.stringify([g.sourceKey, row.date, row.dealText, g.amount, percent]));
    var nextPayments = JSON.parse(JSON.stringify(payments));
    if (!nextPayments.length) nextPayments.push({ id: 'sheet-plan-' + hash(String(l.id) + g.sourceKey).slice(0, 24), no: 1, label: '일시금', amount: g.amount, dueAt: '', paidAt: '', paidConfirmed: false, memo: '' });
    var unpaid = nextPayments.filter(function (p) { return !p.paidAt && !p.paidConfirmed; });
    var delta = target - paid;
    var exact = unpaid.filter(function (p) { return Number(p.amount) === delta; });
    var deposit = exact.filter(function (p) { return p.label === '선금'; });
    if (target === g.amount) unpaid.forEach(function (p) { p.paidConfirmed = true; });
    else if (exact.length === 1) exact[0].paidConfirmed = true;
    else if (paid === 0 && deposit.length === 1) deposit[0].paidConfirmed = true;
    else if (unpaid.length === 1 && Number(unpaid[0].amount) > delta) {
      var p = unpaid[0], remainder = JSON.parse(JSON.stringify(p));
      remainder.id = 'sheet-rest-' + hash(String(l.id) + String(p.id) + paymentHash).slice(0, 24);
      remainder.amount = Number(p.amount) - delta;
      remainder.paidConfirmed = false;
      remainder.no = nextPayments.reduce(function (n, x) { return Math.max(n, Number(x.no) || 0); }, nextPayments.length) + 1;
      if (!p.label || p.label === '일시금') { p.label = '선금'; remainder.label = '잔금'; }
      p.amount = delta; p.paidConfirmed = true;
      nextPayments.splice(nextPayments.indexOf(p) + 1, 0, remainder);
    } else if (sourceAuthoritative) {
      // H is the cumulative receipt amount. Allocate in the existing schedule
      // order, splitting only the boundary installment; preserve its dates/notes.
      var left = delta;
      unpaid.forEach(function (p) {
        if (left <= 0) return;
        var take = Math.min(Number(p.amount), left);
        if (take < Number(p.amount)) {
          var rest = JSON.parse(JSON.stringify(p));
          rest.id = 'sheet-rest-' + hash(String(l.id) + String(p.id) + paymentHash).slice(0, 24);
          rest.amount = Number(p.amount) - take; rest.paidConfirmed = false;
          rest.no = nextPayments.reduce(function (n, x) { return Math.max(n, Number(x.no) || 0); }, nextPayments.length) + 1;
          nextPayments.splice(nextPayments.indexOf(p) + 1, 0, rest);
        }
        p.amount = take; p.paidConfirmed = true; left -= take;
      });
      if (left !== 0) { reject('H열 확인액과 결제 회차 불일치'); return; }
    } else { reject('부분 입금에 대응하는 결제 회차가 불명확함'); return; }
    var metadata = { sourceKey: g.sourceKey, paymentHash: paymentHash, sourceDate: row.date, confirmedAt: now, amount: target,
      percent: percent, actualPaidAt: null, scheduleHash: _crmPaymentScheduleHash(nextPayments, hash) };
    patches.push({ id: String(l.id), ops: [
      { op: 'set', path: ['payments'], value: nextPayments },
      { op: 'set', path: ['paid'], value: target },
      { op: 'set', path: ['contractSheetPaymentSync'], value: metadata }
    ] });
    logs.push({ id: 'contract-paid-' + hash(String(l.id) + paymentHash).slice(0, 32), at: now, date: today,
      company: l.company, leadId: l.id, action: '외부 시트 자동 반영', source: '계약 프로세스 시트', actor: '시스템',
      detail: 'H열 ' + percent + '% 입금 확인 · ' + target.toLocaleString('en-US') + '원 · 실제 입금일 미기재',
      meta: { sourceKey: g.sourceKey, paymentHash: paymentHash, before: { paid: Number(l.paid || 0) },
        after: { paid: target, outstanding: g.amount - target }, sourceRow: row.row } });
    updated.push({ id: l.id, company: l.company, paid: target, outstanding: g.amount - target, actualPaidAt: null });
  });
  return { updated: updated, blocked: blocked, unchanged: unchanged, mutation: { origin: 'contract_sheet_sync', reason: 'contract_payment_confirmation',
    collections: { leads: { idField: 'id', patches: patches }, contractStatusLogs: { idField: 'id', upsert: logs } } } };
}

// O is authoritative for the total. Reconcile the schedule in the same mutation;
// otherwise frontend normalization would restore the old installment total.
export function _crmPlanContractAmountSync(groups, state, now, hash) {
  var patches = [], logs = [], updated = [], blocked = [], unchanged = 0;
  var today = new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10);
  var leads = (state.leads || []).filter(function (l) { return l && !l.archivedAt && !l.archived_at; });
  groups.forEach(function (g) {
    var matches = leads.filter(function (l) { return _crmSyncAliases(l.company).some(function (a) { return g.aliases.indexOf(a) >= 0; }); });
    if (matches.length !== 1) {
      if (matches.length > 1) blocked.push({ company: g.company, sourceKey: g.sourceKey, reason: 'O열 총액: 동명이업체/별칭 중복' });
      return;
    }
    var l = matches[0];
    var eligible = l.status === '계약 완료' || (['프리미팅 확정', '프리미팅 완료', '견적·제안 발송'].indexOf(l.status) >= 0 &&
      (!!l.premeetingAt || !!l.premeetingDoneAt || Number((l.crmMeeting || {}).type) === 1 || (l.crmMeetings || []).some(function (m) { return Number(m.type) === 1; })));
    if (!eligible) return;
    var reject = function (reason) { blocked.push({ id: l.id, company: g.company, sourceKey: g.sourceKey, reason: reason }); };
    if (groups.filter(function (x) { return _crmSyncAliases(l.company).some(function (a) { return x.aliases.indexOf(a) >= 0; }); }).length !== 1 ||
      g.rows.length !== 1 || g.duplicateRows) { reject('O열 총액: 업체·계약 원본 중복 확인 필요'); return; }
    if (!g.amountKnown || !Number.isSafeInteger(g.amount) || g.amount <= 0 || g.lastDate > today) { reject('O열 총액: 금액·날짜 확인 필요'); return; }
    if ((l.contractSheetSync && l.contractSheetSync.sourceKey && l.contractSheetSync.sourceKey !== g.sourceKey) ||
      (l.contractSheetPaymentSync && l.contractSheetPaymentSync.sourceKey !== g.sourceKey)) { reject('O열 총액: 다른 계약 원본과 연결됨'); return; }
    if (g.rows.some(function (r) { return /추가|연장|월관리|매월|월운영/.test(r.memo + ' ' + r.dealText); })) { reject('O열 총액: 추가·반복 계약 확인 필요'); return; }
    var payments = l.payments || [];
    if (payments.some(function (p) { return p.crmManaged || !Number.isSafeInteger(Number(p.amount)) || Number(p.amount) <= 0; })) {
      reject('O열 총액: CRM 관리 또는 유효하지 않은 결제 회차'); return;
    }
    var scheduleTotal = payments.reduce(function (n, p) { return n + Number(p.amount); }, 0);
    var paid = payments.reduce(function (n, p) { return n + (p.paidAt || p.paidConfirmed ? Number(p.amount) : 0); }, 0);
    if (Number(l.paid || 0) > paid || paid > g.amount) { reject('O열 총액이 기존 수령액과 충돌 · 입금 취소 안 함'); return; }
    var totalMatches = Number(l.contractAmount || 0) === g.amount && (l.status === '계약 완료' || Number(l.expected || 0) === g.amount);
    if (scheduleTotal === g.amount && totalMatches) { unchanged += 1; return; }
    var next = JSON.parse(JSON.stringify(payments));
    var unpaid = next.filter(function (p) { return !p.paidAt && !p.paidConfirmed; });
    var remaining = g.amount - paid;
    if (scheduleTotal !== g.amount) {
      if (!unpaid.length && remaining > 0) {
        next.push({ id: 'sheet-amount-' + hash(String(l.id) + g.sourceKey + g.amount + paid).slice(0, 24),
          no: next.reduce(function (n, p) { return Math.max(n, Number(p.no) || 0); }, 0) + 1,
          label: paid ? '잔금' : '일시금', amount: remaining, dueAt: '', paidAt: '', paidConfirmed: false, memo: '' });
      } else if (remaining > 0) {
        var weight = unpaid.reduce(function (n, p) { return n + Number(p.amount); }, 0), assigned = 0;
        unpaid.forEach(function (p, i) {
          var amount = i === unpaid.length - 1 ? remaining - assigned : Math.floor(remaining * Number(p.amount) / weight);
          assigned += amount; p.amount = amount;
        });
        if (unpaid.some(function (p) { return p.amount <= 0; })) { reject('O열 총액: 회차별 최소 금액 확인 필요'); return; }
      } else if (unpaid.length) { reject('O열 총액: 잔여 회차 취소 확인 필요'); return; }
    }
    var proposed = { contractAmount: g.amount, payments: next };
    if (l.status !== '계약 완료') proposed.expected = g.amount;
    // Only our own schedule reallocation may rebase the H planner's fingerprint.
    if (l.contractSheetPaymentSync && JSON.stringify(next) !== JSON.stringify(payments)) {
      proposed.contractSheetPaymentSync = JSON.parse(JSON.stringify(l.contractSheetPaymentSync));
      proposed.contractSheetPaymentSync.scheduleHash = _crmPaymentScheduleHash(next, hash);
    }
    proposed.contractSheetAmountSync = { policy: 'sheet-o-authoritative-v1', sourceKey: g.sourceKey,
      amount: g.amount, appliedAt: now, sourceRow: g.rows[0].row, sourceDate: g.rows[0].date };
    patches.push({ id: String(l.id), ops: Object.keys(proposed).filter(function (k) { return JSON.stringify(l[k]) !== JSON.stringify(proposed[k]); })
      .map(function (k) { return { op: 'set', path: [k], value: proposed[k] }; }) });
    logs.push({ id: 'contract-amount-' + hash(String(l.id) + g.sourceKey + now + JSON.stringify([l.contractAmount, payments, g.amount])).slice(0, 32),
      at: now, date: today, company: l.company, leadId: l.id, action: '외부 시트 자동 반영', source: '계약 프로세스 시트', actor: '시스템',
      detail: 'O열 기준 총액·결제 회차 조정 · ' + (scheduleTotal || Number(l.contractAmount || 0)).toLocaleString('en-US') + '원 → ' + g.amount.toLocaleString('en-US') + '원 · 기존 입금일/메모 보존',
      meta: { sourceKey: g.sourceKey, sourceRow: g.rows[0].row, policy: 'sheet-o-authoritative-v1',
        before: { contractAmount: Number(l.contractAmount || 0), paymentScheduleTotal: scheduleTotal },
        after: { contractAmount: g.amount, paymentScheduleTotal: g.amount } } });
    updated.push({ id: l.id, company: l.company, contractAmount: g.amount });
  });
  return { updated: updated, blocked: blocked, unchanged: unchanged, mutation: { origin: 'contract_sheet_sync', reason: 'contract_sheet_amount_authority',
    collections: { leads: { idField: 'id', patches: patches }, contractStatusLogs: { idField: 'id', upsert: logs } } } };
}

export function _crmPlanContractAndPaymentSync(groups, state, now, hash) {
  var projected = JSON.parse(JSON.stringify(state));
  var apply = function (plan) { plan.mutation.collections.leads.patches.forEach(function (patch) {
      var lead = (projected.leads || []).find(function (l) { return String(l.id) === String(patch.id); });
      if (lead) patch.ops.forEach(function (op) { lead[op.path[0]] = op.value; });
    }); };
  var amount = _crmPlanContractAmountSync(groups, projected, now, hash); apply(amount);
  var held = amount.blocked.map(function (b) { return b.sourceKey; });
  var safeGroups = groups.filter(function (g) { return held.indexOf(g.sourceKey) < 0; });
  var contract = _crmPlanContractAutoSync(safeGroups, projected, now, hash); apply(contract);
  var payment = _crmPlanContractPaymentSync(safeGroups, projected, now, hash, { sourceAuthoritative: true });
  var patches = [], logs = [];
  [amount, contract, payment].forEach(function (plan) {
    plan.mutation.collections.leads.patches.forEach(function (patch) {
      var existing = patches.find(function (p) { return String(p.id) === String(patch.id); });
      if (existing) existing.ops = existing.ops.concat(patch.ops);
      else patches.push(patch);
    });
    logs = logs.concat(plan.mutation.collections.contractStatusLogs.upsert);
  });
  var updated = amount.updated.concat(contract.updated).filter(function (v, i, a) { return a.findIndex(function (x) { return String(x.id) === String(v.id); }) === i; });
  return { updated: updated, blocked: amount.blocked.concat(contract.blocked), unchanged: contract.unchanged,
    paymentUpdated: payment.updated, paymentBlocked: payment.blocked, paymentUnchanged: payment.unchanged,
    mutation: { origin: 'contract_sheet_sync', reason: 'new_contract_and_payment_sync', collections: {
      leads: { idField: 'id', patches: patches }, contractStatusLogs: { idField: 'id',
        upsert: logs }
    } } };
}
