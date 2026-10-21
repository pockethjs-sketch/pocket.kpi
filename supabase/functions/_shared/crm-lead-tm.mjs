// KPI lead → TM view for the buildup workspace (kpi-buildup-api `crmLead`). Pure helpers, unit-tested.
// Only the fields the TM team writes are returned: CRM company number, TM memo (already HTML-stripped by
// the KPI CRM sync), first inquiry and the TM diagnosis checks. Contact details are never included.

// Same TM diagnosis items and choices as the KPI app (SCORE_ITEMS in src/main.jsx).
export const TM_ITEMS = Object.freeze([
  { key: 'rev', label: '매출', opts: ['없음 (매출 전)', '연 1억 미만', '연 1~5억', '연 5억 이상'] },
  { key: 'mvp', label: 'MVP 개발', opts: ['개발 예정', '개발 중', '개발 완료·출시'] },
  { key: 'ceo', label: '대표 전문성', opts: ['무관 분야', '유관 경력', '해당 분야 전문가'] },
  { key: 'team', label: '팀원', opts: ['1인 (대표 혼자)', '2~3인', '4인 이상'] },
  { key: 'gov', label: '지원사업·융자 경험', opts: ['없음', '신청만 해봄', '수혜 1회', '수혜 다수·정책자금'] },
]);

export const CRM_LEAD_LIMITS = Object.freeze({ memoChars: 6000, inquiryChars: 3000 });

const DIGITS = /^[0-9]{1,20}$/;
const plainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

// Keeps line breaks, collapses spaces (tabs, no-break spaces) inside each line, drops runs of blank lines and caps the length.
function block(value, max) {
  if (typeof value !== 'string') return '';
  const lines = value.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/\s+/g, ' ').trim());
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

export function tmChecks(items) {
  if (!plainObject(items)) return [];
  return TM_ITEMS.flatMap((item) => {
    const index = items[item.key];
    return Number.isInteger(index) && item.opts[index] ? [{ label: item.label, value: item.opts[index] }] : [];
  });
}

export function crmLeadView(payload) {
  const lead = plainObject(payload) ? payload : {};
  const sheet = plainObject(lead.crmSheet) ? lead.crmSheet : {};
  const tm = plainObject(lead.score) && plainObject(lead.score.tm) ? lead.score.tm : {};
  const fromId = /^crm-([0-9]{1,20})$/.exec(String(lead.id || ''));
  const clientNo = DIGITS.test(String(sheet.clientNo ?? '')) ? String(sheet.clientNo) : fromId ? fromId[1] : '';
  return {
    clientNo,
    detailMemo: block(sheet.detailMemo, CRM_LEAD_LIMITS.memoChars),
    inquiry: block(sheet.inquiry, CRM_LEAD_LIMITS.inquiryChars),
    tmChecks: tmChecks(tm.items),
  };
}
