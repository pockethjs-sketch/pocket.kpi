export function crmRecentPremeetingRange(now) {
  var day = new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10);
  return { start: new Date(Date.parse(day + 'T00:00:00Z') - 2 * 86400000).toISOString().slice(0, 10), end: day };
}

export function crmPlanRecentPremeetings(rows, state, now, hash) {
  if (!Array.isArray(rows) || !Array.isArray(state.leads)) throw new Error('premeeting_payload_invalid');
  var range = crmRecentPremeetingRange(now), before = {}, working = JSON.parse(JSON.stringify(state.leads));
  state.leads.forEach(function (l) { before[String(l.id)] = l; });
  var blocked = [], seen = {}, count = 0, completed = 0;
  var dayOf = function (v) { var t = Date.parse(v); return isNaN(t) ? '' : new Date(t + 9 * 3600000).toISOString().slice(0, 10); };
  rows.filter(function (m) { var d = dayOf(m.start_dt); return Number(m.mr_type) === 1 && d >= range.start && d <= range.end; })
    .sort(function (a,b) { return String(a.start_dt).localeCompare(String(b.start_dt)); }).forEach(function (m) {
      if (m.ms_no == null) throw new Error('premeeting_schedule_id_missing');
      var mid = String(m.ms_no), signature = JSON.stringify(m);
      if (seen[mid]) { if (seen[mid] !== signature) throw new Error('premeeting_duplicate_conflict'); return; }
      seen[mid] = signature; count++; if (Number(m.mr_checked) === 1) completed++;
      var id = m.client_no != null ? 'crm-' + m.client_no : m.proj_no != null ? 'crm-project-' + m.proj_no : 'crm-meeting-' + mid;
      var matches = working.filter(function (l) {
        return String(l.id) === id || (m.proj_no != null && String(l.projNo) === String(m.proj_no)) ||
          [l.crmMeeting].concat(l.crmMeetings || []).some(function (e) { return e && String(e.msNo) === mid; });
      });
      if (matches.length > 1 || matches.some(function (l) { return l.archivedAt || l.archived_at; })) {
        blocked.push({ meetingId: mid, reason: 'CRM 식별자 중복 또는 보관 업체' }); return;
      }
      var l = matches[0], d = dayOf(m.start_dt), done = Number(m.mr_checked) === 1;
      var managers = Array.isArray(m.managers) ? m.managers : [], owner = managers.map(function (e) { return String(e.emp_name || '').trim(); }).filter(Boolean)[0] || '';
      var company = String(m.client_rep_name || m.client_name || m.mr_name || '(업체명 미등록)').trim();
      if (!l) {
        var contact = (Array.isArray(m.client_contact) ? m.client_contact[0] : null) || {};
        l = { id: id, calendarOnly: true, company: company, contact: String(m.client_name || contact.name || ''), phone: String(contact.number || ''), email: String(m.client_email || ''),
          channel: 'CRM 캘린더', creative: '', buildup: '', buildups: [], lineItems: [], grade: '', status: done ? '프리미팅 완료' : '프리미팅 확정', ctype: '신규',
          tmOwner: '', salesOwner: owner, expected: 0, contractAmount: 0, paid: 0, payments: [], sent: {}, newsletter: false, pushLog: [],
          projNo: m.proj_no || null, premeetingAt: d, premeetingDoneAt: done ? d : '', bookedAt: d, createdAt: '', memo: '', crmMeetings: [], history: [] };
        working.push(l);
      }
      if (!l.company || l.company === '(무명)') l.company = company;
      if (!l.salesOwner && owner) l.salesOwner = owner;
      if (!l.premeetingAt) l.premeetingAt = d;
      if (!l.bookedAt) l.bookedAt = d;
      if (!l.projNo && m.proj_no) l.projNo = m.proj_no;
      if (done) {
        if (!l.premeetingDoneAt) l.premeetingDoneAt = d;
        if (['신규 DB','TM 진행중','프리미팅 확정'].indexOf(l.status) >= 0) l.status = '프리미팅 완료';
      } else if (['신규 DB','TM 진행중'].indexOf(l.status) >= 0) l.status = '프리미팅 확정';
      var entries = Array.isArray(l.crmMeetings) ? l.crmMeetings.slice() : [];
      if (l.crmMeeting && l.crmMeeting.msNo != null && !entries.some(function (e) { return String(e.msNo) === String(l.crmMeeting.msNo); })) entries.push(l.crmMeeting);
      var index = entries.findIndex(function (e) { return String(e.msNo) === mid; });
      var prior = index >= 0 ? entries[index] : null;
      var entry = Object.assign({}, prior || {}, { source: 'mr_schedules', msNo: m.ms_no, type: 1, checked: Number(m.mr_checked) || 0,
        startAt: m.start_dt || '', endAt: m.end_dt || '', managers: managers.map(function (e) { return { no: e.emp_no, name: e.emp_name }; }) });
      if (index >= 0) entries[index] = entry; else entries.push(entry);
      entries.sort(function (a,b) { return String(a.startAt || '').localeCompare(String(b.startAt || '')); });
      l.crmMeetings = entries; l.crmMeeting = entries[entries.length-1];
      if (!prior || JSON.stringify(prior) !== JSON.stringify(entry)) {
        l.history = Array.isArray(l.history) ? l.history : [];
        l.history.push({ date: d, type: done ? '미팅' : '일정', note: 'CRM 프리미팅 동기화 · #' + mid + (done ? ' · 내방완료' : ' · 방문 미확인') });
      }
    });
  var upsert = [], patches = [], logs = [], updatedCompanies = [];
  working.forEach(function (l) {
    var old = before[String(l.id)];
    if (old && JSON.stringify(old) === JSON.stringify(l)) return;
    if (!old) upsert.push(l);
    else patches.push({ id: String(l.id), ops: Object.keys(l).filter(function (k) { return JSON.stringify(l[k]) !== JSON.stringify(old[k]); }).map(function (k) { return { op: 'set', path: [k], value: l[k] }; }) });
    updatedCompanies.push({ id: l.id, company: l.company, added: !old });
    logs.push({ id: 'premeeting-' + hash(String(l.id) + JSON.stringify(l.crmMeetings) + now).slice(0,32), at: now, date: range.end,
      company: l.company, leadId: l.id, action: 'CRM 동기화', source: 'CRM 캘린더', actor: '시스템',
      detail: '최근 3일 프리미팅 ' + (!old ? '기업 생성' : '정보 갱신') + ' · ' + range.start + '~' + range.end,
      meta: { previousStatus: old ? old.status : '미등록', nextStatus: l.status, start: range.start, end: range.end } });
  });
  return { range: range, count: count, completed: completed, scheduled: count-completed, added: upsert.length, updated: patches.length, blocked: blocked, companies: updatedCompanies,
    mutation: { origin: 'crm', reason: 'recent_premeeting_sync', collections: { leads: { idField: 'id', upsert: upsert, patches: patches }, contractStatusLogs: { idField: 'id', upsert: logs } } } };
}
