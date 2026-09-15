// Pure source parser/planner. Bundled into Code.gs by build-contract-sync.mjs.
// No I/O, fuzzy matching, user-data deletion, or payment writes.
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
      service: _crmSyncService(project), paymentText: payment, paymentChecked: /✔|입금\s*완료|지급\s*완료/.test(payment),
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
