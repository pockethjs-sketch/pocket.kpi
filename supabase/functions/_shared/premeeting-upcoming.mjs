// Upcoming CRM premeetings (today onward) for the buildup workspace overview. Pure helpers, unit-tested.
// Identity and display rules follow the KPI premeeting projection: mr_type 1 schedules, company =
// client_rep_name → client_name → mr_name, sales owner = first CRM manager. Phone numbers, e-mail addresses
// and street addresses are dropped here and never stored.

export const PREMEETING_DAYS = 30;
export const PREMEETING_MAX_ROWS = 2000;

const DIGITS = /^[0-9]{1,20}$/;
const WAYS = new Set(['visit', 'zoom', 'outer']);
const DAY = 86_400_000;

const clip = (value, max) => {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text === 'undefined' || text === 'null' ? '' : text.slice(0, max);
};
const digits = (value) => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return DIGITS.test(text) ? text : null;
};

// Korea calendar day (UTC+9, no daylight saving) of an instant.
export function kstDay(date) {
  return new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

// Today (KST) through today + days, inclusive.
export function premeetingWindow(now = new Date(), days = PREMEETING_DAYS) {
  const start = kstDay(now);
  const end = new Date(Date.parse(start + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
  return { start, end };
}

// Query string for the CRM calendar endpoint already used by kpi-crm-sync (same path and filters).
export function premeetingQuery(window) {
  return 'offset=0&limit=1000&state=1&page=schedule'
    + '&start_dt=' + encodeURIComponent(window.start + 'T00:00:00+09:00')
    + '&end_dt=' + encodeURIComponent(window.end + 'T23:59:59+09:00');
}

// Business facts the client entered in the CRM inquiry, as short display strings.
export function clientFacts(info) {
  const out = {};
  if (!info || typeof info !== 'object' || Array.isArray(info)) return out;
  const put = (key, value, max) => { const text = clip(value, max); if (text) out[key] = text; };
  put('annualSales', info.annua_sales, 40);
  put('expectedSales', info.expected_sales, 40);
  put('members', info.member_of_total, 40);
  put('needBuildup', info.need_buildup, 40);
  put('needBuildupText', info.need_buildup_direct, 300);
  put('business', info.business, 600);
  put('homepage', info.homepage, 200);
  put('sectorText', info.sectors_etc, 100);
  put('founded', info.cust_founded === '직접입력' ? info.cust_founded_direct : info.cust_founded, 40);
  const financing = (Array.isArray(info.financing_experience) ? info.financing_experience : [])
    .map((value) => clip(value, 20)).filter((value) => value && value !== '없음').slice(0, 5);
  if (financing.length) out.financing = financing;
  return out;
}

// One CRM schedule row → stored row, or null when it is not a premeeting inside the window.
export function normalizePremeeting(row, window) {
  if (!row || typeof row !== 'object' || Number(row.mr_type) !== 1) return null;
  const scheduleNo = digits(row.ms_no);
  if (!scheduleNo) return null;
  const start = Date.parse(String(row.start_dt || ''));
  if (!Number.isFinite(start)) return null;
  const meetingDay = kstDay(new Date(start));
  if (window && (meetingDay < window.start || meetingDay > window.end)) return null;
  const end = Date.parse(String(row.end_dt || ''));
  const managers = (Array.isArray(row.managers) ? row.managers : [])
    .map((manager) => clip(manager?.emp_name, 100)).filter(Boolean).slice(0, 10);
  const contacts = Array.isArray(row.client_contact) ? row.client_contact : [];
  const info = row.mr_info && typeof row.mr_info === 'object' ? row.mr_info : {};
  return {
    scheduleNo,
    meetingAt: new Date(start).toISOString(),
    meetingEndAt: Number.isFinite(end) && end >= start ? new Date(end).toISOString() : null,
    meetingDay,
    way: WAYS.has(String(row.mr_way)) ? String(row.mr_way) : '',
    company: clip(row.client_rep_name, 200) || clip(row.client_name, 200) || clip(row.mr_name, 200) || '(업체명 미등록)',
    contact: clip(row.client_name, 100) || clip(contacts[0]?.name, 100) || clip(info.client_name, 100),
    salesOwner: managers[0] || '',
    managers,
    bookedBy: clip(row.creater_user, 100),
    projectNo: digits(row.proj_no),
    clientNo: digits(row.client_no),
    visited: Number(row.mr_checked) === 1,
    client: clientFacts(row.client_info),
    note: clip(row.mr_comment, 1000),
  };
}

// CRM response rows → unique schedules sorted by meeting time. `skipped` counts premeetings that could not be read.
export function normalizePremeetings(rows, window) {
  const unique = new Map();
  let skipped = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || Number(row.mr_type) !== 1) continue;
    const item = normalizePremeeting(row, window);
    if (!item) { skipped += 1; continue; }
    unique.set(item.scheduleNo, item);
  }
  const list = [...unique.values()].sort((a, b) => a.meetingAt.localeCompare(b.meetingAt) || a.scheduleNo.localeCompare(b.scheduleNo));
  if (list.length > PREMEETING_MAX_ROWS) throw new Error('premeeting_too_many');
  return { rows: list, skipped };
}

// Stored row → API item for the overview. `link` is the buildup project already prepared from this schedule.
export function premeetingItem(row, link = null) {
  return {
    scheduleNo: row.schedule_no,
    meetingAt: row.meeting_at,
    meetingEndAt: row.meeting_end_at || null,
    meetingDay: row.meeting_day,
    way: row.meeting_way || '',
    company: row.company,
    contact: row.contact || '',
    salesOwner: row.sales_owner || '',
    managers: Array.isArray(row.managers) ? row.managers : [],
    bookedBy: row.booked_by || '',
    projectNo: row.crm_project_no || null,
    visited: !!row.visited,
    client: row.client && typeof row.client === 'object' && !Array.isArray(row.client) ? row.client : {},
    note: row.note || '',
    ...(link ? { linked: link } : {}),
  };
}

// The latest refresh result shown above the list (time and window only, no payloads).
export function premeetingSync(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const done = list.find((run) => run.status === 'COMPLETED') || null;
  const last = list[0] || null;
  return {
    at: done?.completed_at || null,
    start: done?.window_start || null,
    end: done?.window_end || null,
    failed: last?.status === 'FAILED' ? (last.error_code || 'premeeting_sync_failed') : null,
  };
}
