export const WORKSPACES = [
  { id: 'kpi', title: 'KPI 시트', description: '마케팅 성과부터 프리미팅, 계약·수금까지 기존 KPI 업무를 관리합니다.', detail: '성과 확인 · 영업 현황 · 계약·수금', action: 'KPI 시트 열기' },
  { id: 'buildup', title: '빌드업 인텔리전스', description: '고객과 함께 회사 정보를 정리하고 빌드업을 진단하는 영업 상담 화면입니다. 상담은 직원 계정별로 저장됩니다.', detail: '회사 정보 · 빌드업 진단 · 종합 레포트 · 녹음', action: '빌드업 화면 열기' },
];

export const MARKETING_HUB = {
  title: '마케팅 허브',
  href: 'https://pocket-mkt.github.io/',
};

// MASTER/ADMIN only. Visibility is presentation; kpi-account-api re-checks the role on every request.
export const ACCOUNT_WORKSPACE = { id: 'accounts', title: '계정 관리', description: '직원 계정을 만들고 임시 비밀번호 · 권한 · 사용 여부를 관리합니다.', detail: 'MASTER · 관리자 전용', action: '계정 관리 열기' };
export const canManageAccounts = (access) => ['OWNER', 'ADMIN'].includes(access?.role) && (access?.scope || 'all') === 'all';

export const INITIAL_WORKSPACE = { active: 'home', kpiOpened: false, buildupOpened: false, accountsOpened: false };

export function selectWorkspace(state, target) {
  if (!['home', 'kpi', 'buildup', 'accounts'].includes(target)) return state;
  return { ...state, active: target, kpiOpened: state.kpiOpened || target === 'kpi', buildupOpened: state.buildupOpened || target === 'buildup', accountsOpened: (state.accountsOpened || false) || target === 'accounts' };
}

// An opaque-origin frame must never receive the KPI session, storage or business state.
// It reaches the server only through the validated MessagePort bridge (buildupBridge.js);
// the microphone stays denied in the frame because recording runs in this page (buildupRecorder.js).
export const BUILDUP_SANDBOX = 'allow-scripts allow-downloads allow-modals';
export const BUILDUP_FRAME_ALLOW = "camera 'none'; microphone 'none'; geolocation 'none'";
export const BUILDUP_NOTICE = '빌드업 인텔리전스 v4.8 · 상담은 직원 계정별로 자동 저장되고 관리자(OWNER·ADMIN)는 직원별 현황을 봅니다 · 녹음 파일(음성)은 서버에 남지 않으니 필요하면 내려받으세요 · KPI 데이터와는 연동되지 않습니다';
export const BUILDUP_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

export function prepareBuildupDocument(html) {
  if (typeof html !== 'string' || !/<head(?:\s[^>]*)?>/i.test(html)) throw new Error('buildup_document_invalid');
  return html.replace(/<head(?:\s[^>]*)?>/i, head => `${head}<meta http-equiv="Content-Security-Policy" content="${BUILDUP_CSP}">`);
}
