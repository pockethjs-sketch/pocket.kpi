// KPI lead → TM view for the buildup workspace (kpi-buildup-api `crmLead`). Pure helpers, unit-tested.
// Only the fields the TM team writes are returned: CRM company number, TM memo, first inquiry and the TM
// diagnosis checks. Contact details are never included.
// The TM memo and first inquiry come from the newest CRM inquiry record the KPI CRM sync stored
// (`crm_raw_records`, HTML kept → turned into lines here) when it has one, otherwise from the KPI lead
// (`crmSheet`, already flattened by the KPI app). A memo written after the KPI lead was last merged therefore
// still reaches the consultation.

// Same TM diagnosis items and choices as the KPI app (SCORE_ITEMS in src/main.jsx).
export const TM_ITEMS = Object.freeze([
  { key: 'rev', label: '매출', opts: ['없음 (매출 전)', '연 1억 미만', '연 1~5억', '연 5억 이상'] },
  { key: 'mvp', label: 'MVP 개발', opts: ['개발 예정', '개발 중', '개발 완료·출시'] },
  { key: 'ceo', label: '대표 전문성', opts: ['무관 분야', '유관 경력', '해당 분야 전문가'] },
  { key: 'team', label: '팀원', opts: ['1인 (대표 혼자)', '2~3인', '4인 이상'] },
  { key: 'gov', label: '지원사업·융자 경험', opts: ['없음', '신청만 해봄', '수혜 1회', '수혜 다수·정책자금'] },
]);

export const CRM_LEAD_LIMITS = Object.freeze({ memoChars: 6000, inquiryChars: 3000, rawRows: 5 });

const DIGITS = /^[0-9]{1,20}$/;
const plainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

// Keeps line breaks, collapses spaces (tabs, no-break spaces) inside each line, drops runs of blank lines and caps the length.
function block(value, max) {
  if (typeof value !== 'string') return '';
  const lines = value.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/\s+/g, ' ').trim());
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

const NAMED = Object.freeze({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", middot: '·', bull: '•', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' });
function entity(match, name) {
  const lower = String(name).toLowerCase();
  if (lower[0] === '#') {
    const code = lower[1] === 'x' ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
  }
  return Object.prototype.hasOwnProperty.call(NAMED, lower) ? NAMED[lower] : match;
}

// CRM memo HTML (editor output) → plain lines, as the memo reads on screen: paragraphs, line breaks and list items
// become lines, table cells are spaced, inline formatting tags (strong, span, …) vanish without adding spaces,
// entities decode. Only real tags are removed, so a plain-text memo keeps text such as "<1억".
export function memoText(html, max = CRM_LEAD_LIMITS.memoChars) {
  if (typeof html !== 'string' || !html.trim()) return '';
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n- ')
    .replace(/<\s*\/\s*li\s*>/gi, '')
    .replace(/<\s*\/?\s*(p|div|ul|ol|h[1-6]|hr|table|blockquote|pre|section|article)\b[^>]*>/gi, '\n')
    .replace(/<\s*\/\s*tr\s*>/gi, '\n')
    .replace(/<\s*\/?\s*(td|th)\b[^>]*>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, entity);
  return block(text, max);
}

export function tmChecks(items) {
  if (!plainObject(items)) return [];
  return TM_ITEMS.flatMap((item) => {
    const index = items[item.key];
    return Number.isInteger(index) && item.opts[index] ? [{ label: item.label, value: item.opts[index] }] : [];
  });
}

const filled = (value) => typeof value === 'string' && !!value.trim();
const seenAt = (row) => { const at = Date.parse(String(row.last_seen_at ?? '')); return Number.isFinite(at) ? at : -Infinity; };

// The most recently seen stored CRM inquiry row that carries a memo or an inquiry. Rows may come from two lookups
// (client number, project number) in any order and may repeat; rows without a time keep their order, last.
export function latestRawLead(rows) {
  const usable = (Array.isArray(rows) ? rows : []).filter((row) => plainObject(row) && (filled(row.client_memo) || filled(row.iciq_content)));
  return usable.sort((a, b) => (seenAt(b) - seenAt(a)) || 0)[0] || null;
}

// payload = KPI lead `source_payload` (or null), raw = latestRawLead(...) (or null).
export function crmLeadView(payload, raw = null) {
  const lead = plainObject(payload) ? payload : {};
  const sheet = plainObject(lead.crmSheet) ? lead.crmSheet : {};
  const tm = plainObject(lead.score) && plainObject(lead.score.tm) ? lead.score.tm : {};
  const crm = plainObject(raw) ? raw : {};
  const fromId = /^crm-([0-9]{1,20})$/.exec(String(lead.id || ''));
  const clientNo = DIGITS.test(String(sheet.clientNo ?? '')) ? String(sheet.clientNo)
    : fromId ? fromId[1] : DIGITS.test(String(crm.client_no ?? '')) ? String(crm.client_no) : '';
  const rawMemo = memoText(crm.client_memo, CRM_LEAD_LIMITS.memoChars);
  const rawInquiry = memoText(crm.iciq_content, CRM_LEAD_LIMITS.inquiryChars);
  return {
    clientNo,
    detailMemo: rawMemo || block(sheet.detailMemo, CRM_LEAD_LIMITS.memoChars),
    inquiry: rawInquiry || block(sheet.inquiry, CRM_LEAD_LIMITS.inquiryChars),
    tmChecks: tmChecks(tm.items),
  };
}
