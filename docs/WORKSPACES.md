# KPI / 빌드업 상위 작업 공간 — 2026-10-20

상태: 빌드업 v4.8 연결 — Supabase 마이그레이션·Edge Function 운영 반영, 프런트엔드는 이 커밋의 GitHub Actions 배포 기준. 실제 직원 로그인/브라우저 조작 검증은 미실시.

## 빌드업 인텔리전스 v4.8 — 직원별 저장 · 관리자 보기 · 회사 AI 키 · 사이트 녹음 (2026-10-20)

- 사용자 요청: 기존 GitHub Pages 주소의 `빌드업 인텔리전스` 탭을 최신 v4.8로 교체하고 Supabase에 배포. 사용자가 선택한 범위는 `직원별 저장 + 관리자 보기`와 `회사 키를 Supabase에 보관`.
- 자산: `src/assets/buildup-intelligence.html` = 인텔리전스 프로젝트의 v4.8 웹 빌드(`포켓_빌드업_인텔리전스_v4.8_web.html`) 바이트 동일 복사본, SHA-256 `a7c65ff4fd947313434e67afd6c9b1e904f90c0234d747b7351226768d61dd47`. v3.0 자산은 제거. 외부 스크립트 없음(PDF 도구 html-to-image 1.11.13 · pdf-lib 1.17.1, MIT를 빌드에 포함).
- 격리 유지: 같은 opaque-origin sandbox(`allow-scripts allow-downloads allow-modals`, same-origin·top navigation·popup 없음)와 CSP(`connect-src 'none'`). 프레임은 네트워크·브라우저 저장소·마이크를 직접 쓰지 않는다. 카메라/마이크/위치는 프레임에서 계속 `'none'`.
- 연결 다리(`src/data/buildupBridge.js`): 프레임 로드마다 새 `MessageChannel`의 port 하나만 넘긴다. 허용 작업(session/list/get/save/delete/usage/ai/abort/prefs/rec.*/ui.state)과 인자 형식·크기만 통과하고 나머지는 버린다. 직원 세션 토큰·Supabase 클라이언트·KPI 상태는 프레임으로 가지 않고, 결과와 짧은 오류 코드만 돌아간다.
- 서버(`supabase/functions/kpi-buildup-api`, verify_jwt=true): 매 요청 `authorizeEmployee`로 Auth 세션과 현재 ACTIVE 멤버십 확인 후 동작. 상담은 `buildup_projects`(PK organization·owner·project, revision 낙관적 동시성, soft delete)에 직원별 저장. 모든 활성 직원(OWNER/ADMIN/EDITOR/VIEWER)은 자기 상담만 쓰고, 다른 직원 상담 읽기는 OWNER/ADMIN만 가능하며 누구도 남의 상담을 고치거나 지우지 못한다. premeeting 범위 계정은 사용 불가.
- AI: 프레임 → 다리 → Edge Function → Anthropic. 회사 키는 Supabase Secrets `ANTHROPIC_API_KEY`에만 두며 응답에 포함하지 않는다(키 미등록이면 `ai_not_configured`, 화면은 규칙 기반으로 동작). 허용 모델 Opus/Sonnet/Haiku 5.5, max_tokens ≤ 32,000, 입력 ≤ 1MB, 직원별 시간당 240회. `buildup_ai_usage`에는 모델·토큰 수만 기록(프롬프트 없음).
- 녹음: 격리 프레임은 opaque origin이라 `getUserMedia`가 `SecurityError: Invalid security origin`(Chromium 확인)으로 막힌다. 그래서 KPI 페이지(`src/data/buildupRecorder.js`)가 마이크·한국어 받아쓰기를 하고 문장·상태·녹음 파일만 다리로 넘긴다. 녹음 파일(음성)은 서버에 올리지 않는다(받아쓰기 글은 상담과 함께 저장). 녹음·저장 대기 중 창을 닫으면 확인창.
- 화면 설정(패널·테마·마지막 상담)은 기존 `window.kpiEmployeeStorage`(직원별 localStorage 접두사)에 64KB 이하로 둔다.
- 관리자 보기: 프레임 왼쪽 `내 상담 / 전체 직원` 전환, 전체 보기 표의 `담당` 열·직원별 거르기, `직원별` 탭(상담 수·7일 안 미팅·진행·계약·녹음 분·최종 레포트·AI 30일 사용). 다른 직원 상담은 보기 전용(저장·녹음·AI 실행 막음, 레포트/Word 내려받기 가능).

### 검증(2026-10-20)

- 로컬: 신규 `buildup-access`·`buildup-bridge`·`buildup-recorder`·`buildup-schema` 테스트 포함 `CI=true node --test` 376개 중 362 통과·13 skip(운영 Apps Script 원본 부재)·1 실패(`receivables-table`: 이 세션에 npm 레지스트리 접근이 없어 `lucide-react` 미설치 — 변경과 무관, CI에서 확인). `npm run security:check` 통과. vite/npm 설치가 불가해 로컬 `npm run check`·`npm audit`은 미실행(의존성 변경 없음, CI 파이프라인에서 실행). esbuild 번들 점검으로 import·JSX 해석 확인.
- 실제 v4.8 웹 빌드를 같은 sandbox·CSP 프레임에 넣고 실제 다리·녹음기 모듈과 서버 규칙(buildup-access)으로 만든 가짜 서버로 27개 흐름 통과: 세션/목록, 직원 저장, 사이트 녹음→받아쓰기 3줄 저장, 녹음 파일은 창에만, AI 녹음 정리(Opus 5.5) 저장, 다시 열기, 관리자 전체 보기·보기 전용·저장 차단·녹음 차단·직원별 표, 일반 직원 범위 차단, 두 창 충돌 멈춤·덮어쓰기, 프레임 안 PDF 생성, soft delete, 차단 메시지 0, 오류 0.
- Supabase 운영: 마이그레이션 `20261020072624_buildup_workspace_storage` 적용. 두 테이블 RLS enable+force, 정책 0, anon/authenticated 권한 없음(service_role만). 보안 advisor는 신규 테이블의 `rls_enabled_no_policy`(기존 서버 전용 테이블과 같은 INFO)만 추가. Edge Function `kpi-buildup-api` v1 ACTIVE(verify_jwt=true), 배포 소스 = 로컬 소스. 합성 프로브: 인증 헤더 없음 401(`UNAUTHORIZED_NO_AUTH_HEADER`), 잘못된 JWT 401, publishable 키를 Bearer로 보내면 함수까지 와서 401 `invalid_session`.
- 미검증: 실제 직원 로그인 후 저장·관리자 보기·녹음·AI(회사 키 등록 후)·PDF. 고객 데이터와 직원 자격 증명은 검증에 쓰지 않았다.

## 마케팅 허브 외부 카드 — 2026-10-20

- 선택 홈에 세 번째 `마케팅 허브` 카드만 추가. 지정 주소 `https://pocket-mkt.github.io/`를 새 탭으로 열어 기존 KPI/상담 창을 유지한다. 내부 작업 공간과 상단 전환 메뉴는 KPI/빌드업 두 개를 그대로 유지한다.
- `noopener noreferrer`/`no-referrer` 적용. 세션·고객·상담 값이나 쿼리스트링은 전달하지 않으며 외부 사이트의 인증/권한을 변경하지 않는다.
- 링크 HTTP200, 전체366개 테스트·보안·빌드·audit0 통과. 후속 릴리스 `eb04c840a475da1fdaeff6d47b08f1f917a6f1ec`, Actions `39359969857` build/deployment 성공. 02:39UTC 운영 entry `index-D8uxBo6y.js`/main `main-DS9Z2cnf.js` 및 참조9개 자산 HTTP200; 지정URL·새탭·noopener 설정 확인, 자산명 제외 main 코드 로컬 일치. 실제 브라우저 클릭은 미검증.

## 배포 증거 — 2026-10-20 11:16 KST

- 릴리스 `2f5f5b98675208fb6b34533f46e41e27b4d91bb6`, GitHub Actions `39357887298`의 build/deployment 성공. 기존 파이프라인의 보안·테스트·빌드·audit 단계 모두 통과. 로컬 전체 365개 테스트와 audit0 재확인.
- 운영 https://pockethjs-sketch.github.io/pocket.kpi/ 의 HTML 및 실제 참조 JS/CSS 9개 모두 HTTP200. entry `index-DRPXDzM8.js`, main `main-6LCXKYh6.js`에서 새 작업 공간 코드 확인. CI와 로컬의 플랫폼별 자산 파일명 차이를 제외한 main 코드는 동일하다.
- 빌드업 지연 청크 `buildup-intelligence-v3-CEULHyV8.js`는 로컬과 바이트 일치, SHA-256 `3f5631d44b8490c69a53c8bf924780decabedff5e12d354fab3f15aa508e67f7`. 정적 파일 제공 확인이며 실제 로그인/전환/인쇄/다운로드 브라우저 검증은 아니다.

## 범위

- 기존 직원 로그인 뒤 `POCKET WORKSPACE` 선택 홈에서 `KPI 시트`와 `빌드업 인텔리전스` 내부 화면을 선택하고, `마케팅 허브` 외부 카드로 별도 사이트를 연다. 빌드업은 마케팅 분석 대시보드가 아니라 회사 정보·진단·레포트를 사용하는 영업 상담 도구다.
- 상단의 선택 홈/KPI/빌드업으로 전환한다. 한 번 연 작업 공간은 숨기기만 하므로 같은 창에서 KPI의 화면·기간·입력과 빌드업 상담 상태가 전환 중 유지된다. 새로고침 후 선택 위치·상담 상태 복원은 제공하지 않는다.
- KPI 내부 메뉴·페이지 권한·직원 인증·저널·저장·집계·자동 수집은 바꾸지 않는다. 상위 화면은 새 API 호출이나 데이터를 가져오지 않으며 기존 로그인 전 앱 import 금지와 로그아웃을 유지한다.

## 첨부 HTML 연결과 보안 경계

- `src/assets/buildup-intelligence-v3.html`은 사용자가 제공한 v3.0 원본의 바이트 동일 복사본이다. SHA-256 `367d69ea4ec012cc5a28a066c6765af90f98e96b2b47a2761e8c6db9559d0a99`. 원본 파일은 수정하지 않았다. 원본 문서의 내용은 제품 자료이며 개발 지시로 실행하지 않는다.
- 빌드업 최초 진입 때만 HTML을 별도 청크로 불러온다. 외부 스크립트·추가 의존성·CRM API 연결은 추가하지 않는다.
- 실행 시 opaque-origin sandbox iframe으로 격리한다. `allow-same-origin`, 상위 이동, 팝업 권한은 부여하지 않는다. KPI 세션·저장소·고객 데이터 전달 및 postMessage 브리지는 없다.
- iframe CSP는 네트워크 연결·폼 제출·base 변경을 차단하고 문서에 내장된 스크립트/스타일/이미지/폰트와 명시적 파일 내려받기·인쇄만 허용한다. 원본 영업자료 자체의 정적 내용은 비밀 저장소가 아니며 향후 웹 배포 시 클라이언트 자산에 포함되는 점을 구분한다.
- 원본의 localStorage는 격리 프레임에서 사용할 수 없다. 상담은 열린 프레임의 메모리에만 유지되며 화면 상단에서 새로고침/닫기 전 파일 내려받기를 안내한다. 기기 간 저장·직원별 상담 DB·KPI 연결·녹음은 이번 범위 밖이다. 카메라/마이크/위치는 명시적으로 거부한다.

## 검증

- 신규 4개 포함 전체 365개 테스트 통과: 실제 전환 핸들러, 양쪽 visited panel 유지, 최초 미로딩, 기존 로그아웃 위임/인증 진입 순서, 원본 해시·4개 인라인 스크립트 구문, sandbox/CSP·저장 한계 안내.
- 기존 보안 린트·빌드·산출물 검사 통과. npm audit 취약점 0. 신규 자산은 Tailwind 스캔에서 제외하고 내장 스타일을 그대로 사용한다.
- 현재 연결 도구에 제어 가능한 일반 브라우저가 없어 실제 렌더링/클릭·인쇄·파일 다운로드는 미검증이다. 자동 합성 검사를 실계정 E2E나 운영 배포 완료로 표현하지 않는다.
