export const WORKSPACES = [
  { id: 'kpi', title: 'KPI 시트', description: '마케팅 성과부터 프리미팅, 계약·수금까지 기존 KPI 업무를 관리합니다.', detail: '성과 확인 · 영업 현황 · 계약·수금', action: 'KPI 시트 열기' },
  { id: 'buildup', title: '빌드업 인텔리전스', description: '고객과 함께 회사 정보를 정리하고 빌드업을 진단하는 영업 상담 화면입니다.', detail: '회사 정보 · 빌드업 진단 · 종합 레포트', action: '빌드업 화면 열기' },
];

export const INITIAL_WORKSPACE = { active: 'home', kpiOpened: false, buildupOpened: false };

export function selectWorkspace(state, target) {
  if (!['home', 'kpi', 'buildup'].includes(target)) return state;
  return { ...state, active: target, kpiOpened: state.kpiOpened || target === 'kpi', buildupOpened: state.buildupOpened || target === 'buildup' };
}

// An opaque-origin frame must never receive the KPI session, storage or business state.
export const BUILDUP_SANDBOX = 'allow-scripts allow-downloads allow-modals';
export const BUILDUP_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

export function prepareBuildupDocument(html) {
  if (typeof html !== 'string' || !/<head(?:\s[^>]*)?>/i.test(html)) throw new Error('buildup_document_invalid');
  return html.replace(/<head(?:\s[^>]*)?>/i, head => `${head}<meta http-equiv="Content-Security-Policy" content="${BUILDUP_CSP}">`);
}
