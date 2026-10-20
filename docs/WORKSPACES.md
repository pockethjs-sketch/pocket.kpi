# KPI / 빌드업 상위 작업 공간 — 2026-10-20

상태: 빌드업 v4.8 운영 반영(PR #1). 계정 관리·첫 로그인 비밀번호 변경 — Edge Function 운영 반영, 프런트엔드는 이 브랜치 PR 병합 후 GitHub Actions 배포 기준. 실제 직원 로그인/브라우저 조작 검증은 미실시.

## 계정 관리 · 첫 로그인 비밀번호 변경 (2026-10-20)

- 사용자 요청: MASTER 계정은 그대로 두고 `design@pocket.company`, `ceo@pocket.company` 두 계정 추가. 첫 비밀번호는 관리자가 정한 임시 비밀번호이고, 처음 로그인하면 본인이 비밀번호를 정해야 업무 화면이 열린다. MASTER는 로그인 후 `계정 관리` 화면에서 계정을 보고 관리한다.
- 화면(`src/AccountWorkspace.jsx`): 선택 홈 카드와 상단 메뉴에 `계정 관리`(OWNER·ADMIN, 범위 all일 때만 표시 — 표시는 편의이고 권한은 서버가 다시 확인). 계정 추가(이메일·이름·권한·임시 비밀번호 8자 이상), 계정 표(권한 변경, 사용 중지/다시 사용, 임시 비밀번호 재설정, 이름 변경, 비밀번호 상태, 마지막 로그인), 가입 대기(설정의 `직원 등록` 초대 중 미가입) 목록과 `임시 비밀번호로 만들기`. MASTER 별칭 주소는 화면·응답에 나오지 않는다(`MASTER`로 표시).
- 첫 로그인(`src/EmployeeEntry.jsx`, `src/PasswordSetup.jsx`): 기존 세션 확인 직후 `kpi-account-api status`를 묻고 `mustChangePassword`이면 KPI 앱 import 전에 새 비밀번호 화면(12자 이상·같은 글자 반복 금지·확인 칸)만 보여 준다. 저장하면 같은 세션으로 다시 확인해 업무 화면을 연다. status 호출이 실패하면 기존처럼 열린다(가용성 우선, 다음 로그인 때 다시 물음). 브라우저 저장소에 비밀번호를 두지 않는다.
- 서버(`supabase/functions/kpi-account-api`, verify_jwt=true): 모든 동작이 `authorizeEmployee`(Auth getUser + 현재 ACTIVE 멤버십) 뒤에 온다. `status`·`change_password`는 본인만. 임시 비밀번호 상태(`app_metadata.pk_password_change`, 서비스 역할만 설정·해제)이면 그 밖의 동작은 403 `password_change_required`. 관리 동작은 OWNER·ADMIN만, ADMIN 권한 부여·ADMIN 계정 관리는 OWNER만, MASTER·OWNER·SERVICE·본인 계정은 변경 불가. 계정 생성 = Auth 사용자(email_confirm, 플래그) → profiles → ACTIVE 멤버십 → 초대 claimed, 실패 시 역순 삭제. 사용 중지 = 멤버십 ARCHIVED + Auth ban, 다시 사용 = ACTIVE + ban 해제. 감사 기록 `audit_events`(entity_type `employee_account`)에는 권한·상태·임시 여부만 남기고 비밀번호는 저장·기록·응답하지 않는다. DB 마이그레이션·RLS·권한 부여 변경 없음.
- `kpi-buildup-api` v2도 임시 비밀번호 상태 세션을 403 `password_change_required`로 막는다. `kpi-domain-api`(KPI 본 API)는 바꾸지 않았다 — 임시 비밀번호 상태 차단은 로그인 화면과 계정·빌드업 API에서 이뤄진다(서버 전면 강제가 필요하면 후속 작업).
- 두 계정 준비: `employee_invitations`에 `design@pocket.company`, `ceo@pocket.company`(EDITOR, 미가입)만 등록. Auth 계정과 임시 비밀번호는 배포 후 MASTER가 `계정 관리 → 가입 대기 → 임시 비밀번호로 만들기`에서 만든다(비밀번호는 브라우저 → 함수 → Supabase Auth로만 전달, 저장소·문서에 남기지 않음). 일회성 부트스트랩 비밀 등록은 비밀 저장소 쓰기 승인 정책으로 막혀 철회했고, 인증 없는 계정 생성 경로는 코드·배포본 모두에 없다.

### 검증(2026-10-20, 계정 관리)

- 로컬: 신규 `account-access` 8개 포함 `CI=true node --test` 385개 중 371 통과·13 skip·1 실패(`receivables-table`, `lucide-react` 미설치 — 기존과 같은 환경 문제, CI에서 확인). `npm run security:check` 통과. 실제 화면 컴포넌트(KPI 셸·계정 관리·새 비밀번호)를 가짜 서버로 번들·렌더링해 13개 흐름 통과: MASTER 홈 카드·상단 메뉴, MASTER 변경 불가 행, 가입 대기, 계정 만들기(소문자 이메일·입력 비움), 권한 변경, 임시 비밀번호 재설정, 사용 중지 확인, 서버 호출 순서, 짧은 비밀번호 거절, 새 비밀번호 저장 후 업무 화면, 오류 0.
- Supabase 운영: `kpi-account-api` v2 ACTIVE(verify_jwt=true, 배포 소스 = 이 커밋 소스, 부트스트랩 경로 없음), `kpi-buildup-api` v2 ACTIVE. 합성 프로브만 사용: 형식 오류 JWT 401(`UNAUTHORIZED_INVALID_JWT_FORMAT`), 서명 위조 JWT 401(`UNAUTHORIZED_LEGACY_JWT`), 인증 헤더 없음 → 함수 401 `login_required`, 옛 부트스트랩 요청도 401. 스키마 재확인: 멤버십(organization_id,user_id)·초대(organization_id,email) 유일 제약, profiles·audit_events 열·enum 호환, auth.users 트리거 없음.
- 미검증: 실제 MASTER 로그인 후 계정 생성, 직원 첫 로그인 비밀번호 변경, 사용 중지 후 로그인 차단(직원 자격 증명을 검증에 쓰지 않음).

## 빌드업 인텔리전스 v4.9 — 곧 미팅할 CRM 프리미팅을 「프로젝트 전체 보기」에 (2026-10-20)

- 사용자 요청: KPI가 CRM API로 매일 불러오는 프리미팅 기업 목록을 인텔리전스 「프로젝트 전체 보기」에 똑같이 보이게 DB 연동. 지난 미팅은 빼고 오늘 이후(곧 미팅할 기업)만, 매일 아침 8시 업데이트, 오늘 것은 바로 불러오기.
- 출처: KPI CRM 동기화(`kpi-crm-sync`)와 같은 CRM 일정 API(`crm/v3/mr_schedules`, `state=1&page=schedule`, `mr_type=1` 프리미팅)와 같은 표시 규칙(회사 = client_rep_name → client_name → mr_name, 담당 영업 = 첫 CRM 담당자). KPI 리드 · 원본 CRM 증거(`crm_raw_records`) · KPI 프리미팅 반영 함수는 읽지도 바꾸지도 않는다(KPI 반영은 지금처럼 오늘까지만).
- 저장(`supabase/migrations/20261020100000_buildup_upcoming_premeetings.sql`): 서버 전용 `buildup_premeetings`(일정 번호 · 미팅 일시 · 방식 · 회사 · 신청자 이름 · 담당 영업 · 예약 TM · CRM 사전 정보 요약 · CRM 메모)와 `buildup_premeeting_runs`(창 · 건수 · 오류 코드). 전화 · 이메일 · 주소는 저장하지 않는다. RLS enable+force, anon/authenticated 권한 없음. `buildup_store_premeetings()`(security invoker, service_role만 실행)가 오늘~+30일 창을 한 트랜잭션으로 바꾼다: 창 밖 행 거부, CRM에서 사라진 창 안 일정은 `removed_at`, 30일 지난 행 삭제, 저장 건수 = 받은 건수 확인.
- 업데이트: pg_cron `pocket-buildup-premeetings` `0 23 * * *`(UTC = 매일 08:00 KST) → Edge Function `kpi-buildup-premeetings`(verify_jwt + 기존 내부 예약 비밀 `x-kpi-cron-secret` 재사용, 직원 · 브라우저 경로 없음). CRM 토큰은 서버 비밀 `CRM_BEARER_TOKEN`. CRM 응답이 한 페이지(1000건)를 채우면 잘린 것으로 보고 실패 처리(남은 일정을 지우지 않음). 응답 · 실행 기록에는 건수와 짧은 오류 코드만.
- 읽기: `kpi-buildup-api` `premeetings`(직원 세션 + ACTIVE 멤버십 + 빌드업 사용 가능 + 임시 비밀번호 아님) → 오늘(KST) 이후 · 사라지지 않은 일정, 마지막 성공 업데이트 시각. 이미 이 일정으로 만든 상담이 있으면 표시(누가 만들었는지 이름은 OWNER/ADMIN에게만). 연결 다리에 인자 없는 `premeetings` 한 가지만 추가. 상담 요약 허용 키에 `crm`(일정 번호) 추가.
- 화면(인텔리전스 v4.9 웹 빌드): 「프로젝트 전체 보기」 위에 `곧 미팅할 프리미팅 N건 · 오늘 · 7일 안 · 상담 준비 전 · 마지막 업데이트` 줄, 표에 아직 상담이 없는 일정이 점선 `CRM` 줄로 미팅일 순서대로 섞여 보이고(`CRM 예정` 거르기 칩), 캘린더에도 표시. 「상담 준비」는 CRM 정보로 채운 TM 사전 입력(회사명 · 신청자 · 미팅 일시 · TM 담당 · 사전 정보 글)을 열고, 만든 상담은 일정 번호로 이어져 CRM 줄 대신 상담 줄(작은 CRM 표시)로 보인다. TM 입력의 날짜 · 시간 칸을 넓혔다.
- 검증(로컬): `buildup-premeetings` 8개 테스트(창 · KST 경계 · 정규화 · 연락처 제외 · 정렬/중복 · 응답/동기화 형태 · 함수 인증 순서 · 마이그레이션 권한 · API/다리 경로) 포함 전체 테스트 통과(환경 실패 1 제외). 인텔리전스 웹 하네스 43/43(CRM 11개 흐름: 요약 · 3줄 · 다른 직원 준비 표시 · 날짜순 · 거르기 · 캘린더 · TM 미리 채움 2 · 서버 저장 링크 · 상담 줄로 바뀜 · 관리자 이름), 키 파일 모드 6/6, 단위 테스트 통과.
- 운영 상태: 아래 「배포 기록」 참고.

### 배포 기록 — CRM 프리미팅

- 2026-10-20 19시대 KST: 마이그레이션 적용 승인 요청 2회가 승인 없이 닫혀 **운영 DB · 함수 미반영**. 코드 · 마이그레이션 · 테스트는 이 브랜치에만 있다. 승인 후 순서: 마이그레이션 → `kpi-buildup-premeetings` 배포 → `kpi-buildup-api` 재배포 → 예약 작업 명령을 한 번 실행해 오늘 목록 적재 → 건수 · 실행 기록 확인.

## 빌드업 인텔리전스 v4.9 — AI 인사이트를 Claude Opus 5.5로 (2026-10-20)

- 사용자 요청: 빌드업 인텔리전스의 AI 인사이트 기능을 Opus 5.5 API로 연동.
- 자산: `src/assets/buildup-intelligence.html` = 인텔리전스 v4.9 웹 빌드(`포켓_빌드업_인텔리전스_v4.9_web.html`, CRM 프리미팅 포함 최종본) 바이트 동일 복사본, SHA-256 `60b42f2e559d0376717f2309d609729744ad10678812932f1b5ab285c8db961c`.
- 변경: 워크스페이스(회사 키) 모드의 모든 AI 요청(녹음 중 자동·버튼 AI 인사이트, AI 대화, TM 정리, 녹음 정리, 상세 레포트)이 `claude-opus-5-5`로 고정된다(개인 설정과 무관). 대화 인텔리전스 머리말에 `Opus 5.5 연결됨`(풍선말 `회사 AI 연결됨 · Opus 5.5`)을 한 줄로 보이고, 설정 안내 문구를 바꿨다. 키 파일 모드·claude.ai 링크 모드는 그대로.
- 서버 변경 없음: `kpi-buildup-api`는 이미 `claude-opus-5-5`를 허용하고 회사 키 `ANTHROPIC_API_KEY`(Supabase Secrets)로 Anthropic을 부른다. 키가 없으면 `aiReady=false`라 화면은 규칙 기반으로 돌고 「회사 AI 키가 아직 등록되지 않았습니다」를 안내한다. 키를 등록하면 재배포 없이 다음 요청부터 쓴다.
- 키 등록: 2026-10-20 18:3x KST 보안 입력창(값이 대화·코드를 거치지 않음)을 요청했으나 사용자가 닫아 아직 미등록. Supabase 대시보드 Edge Functions → Secrets에서 등록하거나 입력창을 다시 요청한다.
- 검증: 인텔리전스 웹 하네스(실제 연결 다리·녹음기·서버 규칙) 32/32 — 머리말 한 줄 표시, 녹음 뒤 자동 인사이트·버튼 인사이트(카드 표시)·AI 대화(스트리밍)·녹음 정리 모두 Opus 5.5 요청, 키 없음 상태 안내. 키 파일 모드 6/6, 단위 테스트 통과. 실제 Anthropic 호출은 키 등록 전이라 미검증.

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
