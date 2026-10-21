# KPI / 빌드업 상위 작업 공간 — 2026-10-20

상태: 빌드업 v4.8 운영 반영(PR #1). 계정 관리·첫 로그인 비밀번호 변경 — Edge Function 운영 반영, 프런트엔드는 이 브랜치 PR 병합 후 GitHub Actions 배포 기준. 실제 직원 로그인/브라우저 조작 검증은 미실시.

## 빌드업 인텔리전스 v4.9 — AI 비용 줄이기: 자동 분석 Haiku · 녹음 보정 Sonnet · 생각 깊이 · 잘림 수정 (2026-10-21)

- 사용자 질문: 오늘 넣은 $5가 하루도 안 돼 소진된 이유. 사용 기록(건수 · 토큰만): 11:07~11:55 KST 녹음 한 번(47.9분)에 회사 키 호출 69회 · 입력 66.2만 · 출력 12.9만 토큰 = $5.22(Opus 5.5 $4/$20). 그중 64회(약 $4.75, 91%)가 녹음 중 20초 자동 분석이었고 모두 출력 한도 1,800에 걸려 답이 잘렸다(카드 0) — Opus 5.5는 생각을 끌 수 없고 생각도 출력 한도 · 과금에 든다. 호출 간격 중앙값 30초(응답 평균 20초라 끝나자마자 다음 호출), 입력은 처음 10회 평균 6,700 → 마지막 10회 10,670토큰.
- 결정(사용자): 녹음 중 20초 자동 분석만 Haiku 5.5. 녹음 AI 보정 모델은 「상관없음」 → Sonnet 5.5로. 하루 사용 상한은 「일단 대기」(구현하지 않음). AI 대화 · 녹음 정리 · 레포트 · AI 인사이트 버튼은 Opus 5.5 그대로.
- 서버(`kpi-buildup-api` v9): `ai`가 선택 값 `effort`(low/medium/high만)를 받아 Anthropic `output_config.effort`로 넘긴다(그 밖의 키는 계속 버림). 연결 다리도 같은 세 값만 통과.
- 화면(인텔리전스 웹 빌드): 자동 분석 Haiku 5.5 · effort low · 출력 한도 4,000, 버튼 AI 인사이트 Opus · low · 6,000, AI 대화 Opus 한도 1,400 → 4,000, TM 「자동 정리」 2,000 → 6,000 · low, 녹음 정리 6,000/4,000 → 12,000/8,000, 녹음 AI 보정 Sonnet 5.5 · low · 12,000(잘리면 반으로 나눠 다시). effort를 받지 않는 경우 한 번만 빼고 다시 부르고 그 창에서는 더 보내지 않는다. 머리말 풍선말 `회사 AI 연결됨 · Opus 5.5 · 녹음 중 자동 분석 Haiku 5.5`, 설정 안내도 같은 내용. 사이트 안내 줄(`BUILDUP_NOTICE`)의 「녹음 파일은 서버에 남지 않으니 … KPI 데이터와는 연동되지 않습니다」(이제 사실이 아님)를 「녹음 파일은 회사 전용 저장소에 보관되고 … 고객께 녹음을 알려 주세요」로 바꿨다.
- 예상(추정): 같은 48분 녹음의 자동 분석 ≈ $0.1(현재 $4.75), 녹음 1시간 AI 보정 ≈ $0.4(Sonnet · low).
- 검증(로컬): KPI 413개 중 398 통과 · 13 skip · 2 환경 실패, effort 허용 값 · 버림 · 다리 검사 테스트 추가. 인텔리전스 웹 하네스 78/78(자동 분석 Haiku · low · 4,000, 버튼 Opus · low · 6,000, 대화 4,000, 녹음 정리 12,000, 보정 Sonnet · low, effort 거절 시 한 번 빼고 다시), 로컬 63/63 · 공유 31/31 · 키 파일 6/6 · 단위 테스트 통과.
- 운영 반영: `kpi-buildup-api` v9 ACTIVE 16:05 KST(verify_jwt), 배포 소스 = 저장소 소스(다시 읽어 7개 파일 비교). 합성 프로브: 형식 오류 토큰 → 게이트웨이 401. 반영 뒤 직원 요청 200, AI 호출은 계속 503(크레딧 부족 — 충전 전).
- 미검증: 실제 Anthropic에서 Haiku · Sonnet · effort 응답(크레딧 충전 전이라 호출 불가). 화면은 PR #5 병합 후.

## 빌드업 인텔리전스 v4.9 — 녹음 서버 보관 · 정밀 받아쓰기(화자 구분) · AI 보정 · 목록 날짜 묶음 (2026-10-21)

- 사용자 요청: 미팅 녹음이 중요하고 보통 2명이 미팅한다 — 녹음 보정 등 기능을 API로 고도화. 고른 것: 받아쓰기 엔진 CLOVA Speech, 녹음 파일 계속 보관, 범위 「정밀 받아쓰기 + AI 보정」. 함께 받은 요청: 왼쪽 프로젝트 목록을 만든 날짜별로 묶고 오늘 말고는 접기, 프로젝트가 만들어진 일정은 「프로젝트 전체 보기」에서 「프로젝트 생성됨」으로 표시.
- 저장(`supabase/migrations/20261021053437_buildup_recordings.sql`, 운영 적용): 서버 전용 `buildup_recordings`(녹음 id · 직원 · 상담 · 녹음 키 · 저장 경로 · 형식 · 크기 · 길이 · 받아쓰기 상태 · 화자 수 · 오류 코드 · 결과 `{segments,speakers}`). RLS enable+force, anon/authenticated 권한 없음. 비공개 Storage 버킷 `buildup-audio`(공개 아님, 오디오 형식 14가지만, `storage.objects` 정책 없음 → 브라우저 역할은 목록 · 읽기 · 쓰기 모두 불가). 파일 경로 `<조직>/<직원>/<상담>/<녹음 id>.<확장자>`.
- 서버(`kpi-buildup-api` v8): 기존 직원 확인 뒤 `audioUpload`(내 상담이 서버에 있어야 함 · 형식 · 크기 500MB · 길이 6시간 확인 → 한 번 쓰는 서명 업로드 토큰), `audioUploaded`(저장소에 파일이 실제로 있는지 확인), `recordings` · `audioUrl`(재생용 서명 URL 10분) · `transcript`(본인 · OWNER/ADMIN은 남의 것도 읽기만), `transcribe`(본인 녹음만 · 직원당 시간당 20회 · 서명 URL 6시간을 CLOVA에 넘김 · 처리 중 중복 요청은 그대로 돌려줌). 목록 응답에 `createdAt`. Anthropic이 400으로 거절한 크레딧 부족 · 사용 한도를 `ai_credit_low` · `ai_limit_reached` 코드로 바꿔 화면이 안내하게 했다.
- CLOVA 결과 받기(`kpi-buildup-stt-callback` v1, verify_jwt=false — CLOVA가 Supabase 토큰을 보낼 수 없음): 녹음마다 한 번 쓰는 32바이트 비밀을 콜백 주소에 넣고 DB에는 SHA-256만 둔다. 처리 중인 그 녹음 · 비밀이 맞을 때만 결과(시각 · 화자 번호 · 문장 · 신뢰도)를 쓰고 비밀을 지운다. CORS 없음, 응답에 데이터 없음, 본문 기록 안 함. 비밀 `CLOVA_SPEECH_INVOKE_URL` · `CLOVA_SPEECH_SECRET`이 없으면 `transcribe`는 503 `stt_not_configured`(화면은 「서버 설정 전」 안내).
- 연결 다리: `audio.put`(녹음 파일 ArrayBuffer 전달, 500MB) · `audio.get`(서명 URL로 받아 프레임에 전달) · `recordings` · `transcribe`(화자 0/2/3/4 · 키워드 300개) · `transcript`. 프레임은 저장소 경로 · 토큰 · 서명 URL을 보지 않는다. 사이트 녹음기 비트레이트 32kbps(1시간 ≈ 14MB).
- 화면(인텔리전스 v4.9 웹 빌드): 녹음을 멈추면 서버에 올리고(계속 보관) 20초 넘는 녹음은 설정에 따라 정밀 받아쓰기를 자동 시작(화자 기본 2명, 회사명 · 대표 · 업종 · 포켓 용어를 키워드로). 받아쓰기 탭 「정밀 받아쓰기」 상자에서 진행 · 다시 받아쓰기 · 화자 이름 고르기 · 두 화자 맞바꾸기 · 미팅 기록에 붙이기. 결과가 오면 AI(처음 Opus 5.5 → 같은 날 Sonnet 5.5로 변경, 위 「AI 비용 줄이기」)가 잘못 들은 말 · 회사명 · 숫자 · 띄어쓰기를 고치고 화자를 「영업 / 대표님」으로 정한다(2,500자 묶음 · 첫 묶음 뒤 셋씩 함께 · 스트리밍 · 출력 한도 12,000, 답이 잘리면 묶음을 반으로 나눠 다시). 받아쓰기 탭과 녹음 정리는 그 녹음 시간대를 정밀본(화자 이름)으로 쓴다(고친 줄은 원문을, 불확실한 줄은 이유를 풍선말로). 다시 받아쓰기가 실패해도 받아 둔 정밀본은 그대로. 다른 창 · 다른 PC에서는 미팅 기록의 「서버에서 불러와 듣기」로 재생. 관리자 보기(남의 상담)는 정밀본 보기만. 크레딧 부족 · 한도 · 키 오류면 그 창의 20초 자동 분석을 멈추고 한 번 안내(머리말 `Opus 5.5 · 자동 분석 멈춤`).
- 왼쪽 목록 · 전체 보기: 목록을 만든 날짜별로 묶어 오늘(또는 지금 연 상담이 든 날)만 펼치고 지난 날은 접는다(머리 `오늘 · 26.10.21 생성 N`). 「프로젝트 전체 보기」에서 CRM 일정으로 만든 상담 줄과 다른 직원이 만든 CRM 일정 줄에 「프로젝트 생성됨」(이름은 관리자만), 요약 줄 `상담 준비 전 N · 프로젝트 생성됨 K`, 「CRM 예정」 거르기는 둘을 함께. 사용자가 말한 「전체 리스트」는 「프로젝트 전체 보기」 표로 해석했다.
- 운영 데이터(건수만): 오늘 회사 키 AI 호출 — 11:07~11:55 KST 69회 완료(평균 입력 9,591 · 출력 1,892 토큰, 자동 분석 64회가 출력 한도 1,800에 걸림 — Opus 5.5는 생각을 끌 수 없고 생각도 출력 한도에 든다), 12:09부터 149회 모두 Anthropic HTTP 400 거절(완료 0). v8 배포 뒤 같은 거절 8건이 모두 503(`ai_credit_low` 또는 `ai_limit_reached` — 공급자 메시지의 크레딧 잔액 · 사용 한도 문구로 분류)으로 나와 **크레딧 부족 또는 사용 한도 도달이 확인**됐다(오전 사용액 약 $5.2 직후). Anthropic 콘솔 Billing · Limits에서 충전 · 한도 조정 필요(공급자 메시지는 저장하지 않음).
- 검증(로컬): KPI 413개 중 398 통과 · 13 skip · 2 실패(`postcss` · `lucide-react` 미설치 — 기존 환경 문제), 녹음 서버 규칙 8 · 다리 6 · AI 오류 코드 테스트 포함. `npm run security:check` 통과, 번들 확인 통과. 인텔리전스 웹 하네스 77/77(서버 보관 · 녹음 id, 20초 안은 자동 시작 안 함, 키워드 · 화자 수, 받아쓰는 중, AI 보정 지시문 · 스트리밍, 정밀본 표시 · 풍선말, 서버 저장, 화자 바꾸기, 잘린 답 반 나눠 다시, 미팅 기록 붙이기, 키 없음 안내 · 정밀본 유지, 새로 고친 뒤 정밀본 · 서버 재생, 관리자 보기 전용, 크레딧 부족 안내 · 자동 분석 멈춤, 날짜 묶음 2), 로컬 63/63 · 공유 31/31 · 키 파일 6/6 · 단위 테스트(정밀 받아쓰기 17개 포함) 통과.
- 운영 반영(서버): 마이그레이션 `20261021053437_buildup_recordings` 적용 — RLS enable/force, 표 정책 0 · anon/authenticated 권한 없음, 버킷 비공개 · 형식 14 · 크기 제한은 프로젝트 전역 값, `storage.objects` 정책 0 확인. `kpi-buildup-api` v8 ACTIVE 14:39 KST(verify_jwt), `kpi-buildup-stt-callback` v1 ACTIVE 14:40 KST(verify_jwt=false). 두 배포본 소스를 다시 읽어 저장소와 같음을 확인. 합성 프로브만: 콜백 틀린 비밀 401 · 형식 오류 401 · GET 405, API 형식 오류 토큰 401.
- 남은 일(사용자): CLOVA Speech 도메인(장문 인식) 만들기 → Secret Key · Invoke URL을 Supabase Edge Functions Secrets `CLOVA_SPEECH_SECRET` · `CLOVA_SPEECH_INVOKE_URL`에 등록(재배포 불필요). Storage 전역 업로드 한도(기본 50MB ≈ 32kbps 3.5시간)보다 긴 녹음을 올리려면 한도 상향. Anthropic 크레딧 충전. 프런트엔드는 PR #5 병합 후 배포.
- 미검증: 실제 CLOVA 호출 · 콜백(키 등록 전), 실제 직원 브라우저에서 업로드 · 재생 · 보정(프런트엔드 배포 전).

## 빌드업 인텔리전스 v4.9 — KPI TM 메모를 상담 TM 기록에 (2026-10-21)

- 사용자 요청: KPI 리드에 TM팀이 적어 둔 내용 — CRM 기업 번호(`crmSheet.clientNo`), TM 메모(`crmSheet.detailMemo`, HTML 제거본), 최초 문의(`crmSheet.inquiry`), TM 진단(`score.tm.items`) — 을 빌드업 프로젝트의 TM 기록(미팅 기록 TM 탭 · TM 사전 입력)에서 보이게. 지금은 CRM 사전 정보만 보이고 체크값이 `제품/서비스로_인한_매출_발생`처럼 밑줄로 보였다.
- 경로: 프레임은 KPI 직원 토큰을 받지 않고 `kpi-domain-api action=crm`(전체 리드)도 부르지 않는다. 연결 다리에 `crmLead` 한 가지(인자: 일정 번호, 선택 프로젝트 번호 — 숫자 1~20자리만)를 더했고, `kpi-buildup-api`가 기존 직원 확인(세션 · ACTIVE 멤버십 · 빌드업 사용 가능 · 임시 비밀번호 아님) 뒤에 서버에 저장된 같은 조직의 프리미팅 일정(`buildup_premeetings`)에서 CRM 기업 번호 · 프로젝트 번호를 읽고, 같은 조직 · 보관 안 된 KPI 리드를 `source_payload.id = crm-<기업 번호>` → `crmSheet.clientNo` → `projNo` 순서로 찾는다. 딱 하나일 때만 쓰고 둘 이상이면 고르지 않는다(`found:false`).
- 응답은 네 칸뿐(`supabase/functions/_shared/crm-lead-tm.mjs` `crmLeadView`): CRM 기업 번호, TM 메모(줄바꿈 유지 · 6,000자), 최초 문의(3,000자), TM 진단(KPI `SCORE_ITEMS`와 같은 이름 · 보기 글자로 바꾼 `{label,value}`). 회사명 · 신청자 · 전화 · 이메일 · 원본 payload는 돌려주지 않는다. 빌드업을 쓰는 직원(범위 all)은 KPI에서 이미 모든 리드를 볼 수 있어 볼 수 있는 범위는 넓어지지 않는다(premeeting 범위 계정은 빌드업 사용 불가 그대로). DB 마이그레이션 · RLS · 권한 · CORS 변경 없음.
- 화면(인텔리전스 v4.9 웹 빌드): 「상담 준비」로 연 TM 사전 입력이 CRM 블록 아래에 `[KPI TM · CRM 기업 #번호]` 블록(TM 진단 / TM 메모 / 최초 문의)을 넣고 안내 줄(불러오는 중 · 넣음 · 못 찾음 · 실패 + 다시 불러오기)을 보인다. 만든 상담의 TM 기록에 그대로 저장된다. 미팅 기록 TM 탭에 `KPI TM 메모 불러오기 / 다시 불러오기` — 블록이 없는 예전 상담은 TM 탭을 열 때 한 번 자동으로 채우고, 다시 불러오면 넣었던 블록 자리만 새 내용으로 바꾼다(직접 쓴 글은 그대로). 5분 안에는 받아 둔 값을 다시 쓰고 버튼을 누르면 새로 받는다. CRM 체크값의 밑줄을 띄어 쓴다(새로 채울 때 · 전체 보기 표 · 예전 TM 기록의 CRM 블록 체크값 줄만 — 주소 · 메모는 그대로). 미팅 기록 · TM 글 칸을 키웠다(CSS 우선순위 때문에 112px로 줄어 있던 것 → 미팅 기록 220~460px · TM 180~340px, 화면 높이에 맞춤). 모달이 열리자마자 다시 그려져도 글 칸 커서를 유지한다.
- 운영 데이터 확인(건수만): 곧 있을 프리미팅 21건 중 20건이 일정의 기업 번호로 KPI 리드 하나와 이어지고 18건에 TM 메모, 5건에 최초 문의, 1건에 TM 진단 값이 있다. 이미 CRM 일정으로 만든 빌드업 상담 2건도 모두 TM 메모가 있는 리드와 이어진다. 리드 1,135행이라 JSON 경로 조회에 색인은 더하지 않았다.
- 검증(로컬): `crm-lead-tm` 5개 테스트(TM 진단 이름 · 보기 = KPI `SCORE_ITEMS`, 진단 읽기, 연락처 제외 · 길이 제한, 서버 동작 경로 · 조직 범위 · 하나만, 다리 인자 검사) 포함 전체 399개 중 384 통과 · 13 skip · 2 실패(`postcss` · `lucide-react` 미설치 — 기존과 같은 환경 문제). `npm run security:check` 통과, 번들 확인 통과. 인텔리전스 웹 하네스 55/55(KPI TM 13개 흐름 추가: 일정 · 프로젝트 번호로 한 번 부름, 블록 위치 · 내용, 밑줄 정리, 서버 저장, 미팅 기록 버튼 · 넣어 둔 상담은 다시 부르지 않음, 누르면 새로 받아 블록만 교체, 예전 CRM 블록 정리, 저장, 실패 안내 · 다시 불러오기, 블록 없는 상담 자동 채움, 커서 유지), 로컬 63/63 · 공유 31/31 · 키 파일 6/6 · 단위 테스트 통과.
- 운영 반영(서버): `kpi-buildup-api` v7 ACTIVE 2026-10-21 11:57 KST(verify_jwt). 11:53 v6과 같은 코드에서 도우미의 공백 정규식만 ASCII `\s`로 바꿔 배포 소스를 저장소와 똑같이 맞췄다(배포본 다시 읽어 확인). 합성 프로브만: 세션 없음 → 함수 401 `login_required`, 형식 오류 토큰 → 게이트웨이 401 `UNAUTHORIZED_INVALID_JWT_FORMAT`. 배포 전후 직원 요청은 200/204만(상태 코드 · 건수만 확인). 프런트엔드(자산 · 연결 다리 `crmLead`)는 이 PR 병합 후 배포 — 그 전에는 화면이 `crmLead`를 부르지 않는다.

## 계정 관리 · 첫 로그인 비밀번호 변경 (2026-10-20)

- 사용자 요청: MASTER 계정은 그대로 두고 `design@pocket.company`, `ceo@pocket.company` 두 계정 추가. 첫 비밀번호는 관리자가 정한 임시 비밀번호이고, 처음 로그인하면 본인이 비밀번호를 정해야 업무 화면이 열린다. MASTER는 로그인 후 `계정 관리` 화면에서 계정을 보고 관리한다.
- 화면(`src/AccountWorkspace.jsx`): 선택 홈 카드와 상단 메뉴에 `계정 관리`(OWNER·ADMIN, 범위 all일 때만 표시 — 표시는 편의이고 권한은 서버가 다시 확인). 계정 추가(이메일·이름·권한·임시 비밀번호 12자 이상 — 이 프로젝트 Supabase 인증 정책이 12자 미만을 거절), 계정 표(권한 변경, 사용 중지/다시 사용, 임시 비밀번호 재설정, 이름 변경, 비밀번호 상태, 마지막 로그인), 가입 대기(설정의 `직원 등록` 초대 중 미가입) 목록과 `임시 비밀번호로 만들기`. MASTER 별칭 주소는 화면·응답에 나오지 않는다(`MASTER`로 표시).
- 첫 로그인(`src/EmployeeEntry.jsx`, `src/PasswordSetup.jsx`): 기존 세션 확인 직후 `kpi-account-api status`를 묻고 `mustChangePassword`이면 KPI 앱 import 전에 새 비밀번호 화면(12자 이상·같은 글자 반복 금지·확인 칸)만 보여 준다. 저장하면 같은 세션으로 다시 확인해 업무 화면을 연다. status 호출이 실패하면 기존처럼 열린다(가용성 우선, 다음 로그인 때 다시 물음). 브라우저 저장소에 비밀번호를 두지 않는다.
- 서버(`supabase/functions/kpi-account-api`, verify_jwt=true): 모든 동작이 `authorizeEmployee`(Auth getUser + 현재 ACTIVE 멤버십) 뒤에 온다. `status`·`change_password`는 본인만. 임시 비밀번호 상태(`app_metadata.pk_password_change`, 서비스 역할만 설정·해제)이면 그 밖의 동작은 403 `password_change_required`. 관리 동작은 OWNER·ADMIN만, ADMIN 권한 부여·ADMIN 계정 관리는 OWNER만, MASTER·OWNER·SERVICE·본인 계정은 변경 불가. 계정 생성 = Auth 사용자(email_confirm, 플래그) → profiles → ACTIVE 멤버십 → 초대 claimed, 실패 시 역순 삭제. 사용 중지 = 멤버십 ARCHIVED + Auth ban, 다시 사용 = ACTIVE + ban 해제. 감사 기록 `audit_events`(entity_type `employee_account`)에는 권한·상태·임시 여부만 남기고 비밀번호는 저장·기록·응답하지 않는다. DB 마이그레이션·RLS·권한 부여 변경 없음.
- `kpi-buildup-api` v2도 임시 비밀번호 상태 세션을 403 `password_change_required`로 막는다. `kpi-domain-api`(KPI 본 API)는 바꾸지 않았다 — 임시 비밀번호 상태 차단은 로그인 화면과 계정·빌드업 API에서 이뤄진다(서버 전면 강제가 필요하면 후속 작업).
- 두 계정 준비: `employee_invitations`에 `design@pocket.company`, `ceo@pocket.company`(EDITOR, 미가입)만 등록. Auth 계정과 임시 비밀번호는 배포 후 MASTER가 `계정 관리 → 가입 대기 → 임시 비밀번호로 만들기`에서 만든다(비밀번호는 브라우저 → 함수 → Supabase Auth로만 전달, 저장소·문서에 남기지 않음). 일회성 부트스트랩 비밀 등록은 비밀 저장소 쓰기 승인 정책으로 막혀 철회했고, 인증 없는 계정 생성 경로는 코드·배포본 모두에 없다.

### 검증(2026-10-20, 계정 관리)

- 로컬: 신규 `account-access` 8개 포함 `CI=true node --test` 385개 중 371 통과·13 skip·1 실패(`receivables-table`, `lucide-react` 미설치 — 기존과 같은 환경 문제, CI에서 확인). `npm run security:check` 통과. 실제 화면 컴포넌트(KPI 셸·계정 관리·새 비밀번호)를 가짜 서버로 번들·렌더링해 13개 흐름 통과: MASTER 홈 카드·상단 메뉴, MASTER 변경 불가 행, 가입 대기, 계정 만들기(소문자 이메일·입력 비움), 권한 변경, 임시 비밀번호 재설정, 사용 중지 확인, 서버 호출 순서, 짧은 비밀번호 거절, 새 비밀번호 저장 후 업무 화면, 오류 0.
- Supabase 운영: `kpi-account-api` v2 ACTIVE(verify_jwt=true, 배포 소스 = 이 커밋 소스, 부트스트랩 경로 없음), `kpi-buildup-api` v2 ACTIVE. 합성 프로브만 사용: 형식 오류 JWT 401(`UNAUTHORIZED_INVALID_JWT_FORMAT`), 서명 위조 JWT 401(`UNAUTHORIZED_LEGACY_JWT`), 인증 헤더 없음 → 함수 401 `login_required`, 옛 부트스트랩 요청도 401. 스키마 재확인: 멤버십(organization_id,user_id)·초대(organization_id,email) 유일 제약, profiles·audit_events 열·enum 호환, auth.users 트리거 없음.
- 미검증: 실제 MASTER 로그인 후 계정 생성, 직원 첫 로그인 비밀번호 변경, 사용 중지 후 로그인 차단(직원 자격 증명을 검증에 쓰지 않음).

## 사이트 배포 기록 — PR #2 · PR #3 (2026-10-21)

- PR #2 머지(`6dd89d3`) 뒤 배포가 `npm test`에서 멈춤: `tests/kpi-ui.test.mjs`가 빌드업 자산 해시를 v4.8 값으로 따로 고정하고 있었다. PR #3(`7f80237`)에서 이 테스트가 `workspace-shell.test.mjs`의 고정 값 하나를 읽게 바꿨다(테스트만 변경).
- 2026-10-21 00:13 KST 배포 완료(Deploy Pocket KPI run 39446212351, build · deployment 성공). 사이트에 계정 관리 · 첫 로그인 비밀번호 변경 · 빌드업 인텔리전스 v4.9(Opus 5.5 · CRM 프리미팅 · 화면 크기 · 왼쪽 목록)가 반영됐다. 서버는 그 전에 반영 완료.
- 남은 일(대표님): 계정 관리에서 직원 계정(임시 비밀번호) 만들기, Supabase Secrets에 `ANTHROPIC_API_KEY` 등록.

## 빌드업 인텔리전스 v4.9 — 곧 미팅할 CRM 프리미팅을 「프로젝트 전체 보기」에 (2026-10-20)

- 사용자 요청: KPI가 CRM API로 매일 불러오는 프리미팅 기업 목록을 인텔리전스 「프로젝트 전체 보기」에 똑같이 보이게 DB 연동. 지난 미팅은 빼고 오늘 이후(곧 미팅할 기업)만, 매일 아침 8시 업데이트, 오늘 것은 바로 불러오기.
- 출처: KPI CRM 동기화(`kpi-crm-sync`)와 같은 CRM 일정 API(`crm/v3/mr_schedules`, `state=1&page=schedule`, `mr_type=1` 프리미팅)와 같은 표시 규칙(회사 = client_rep_name → client_name → mr_name, 담당 영업 = 첫 CRM 담당자). KPI 리드 · 원본 CRM 증거(`crm_raw_records`) · KPI 프리미팅 반영 함수는 읽지도 바꾸지도 않는다(KPI 반영은 지금처럼 오늘까지만).
- 저장(`supabase/migrations/20261020104259`~`20261020104429` 네 파일): 서버 전용 `buildup_premeetings`(일정 번호 · 미팅 일시 · 방식 · 회사 · 신청자 이름 · 담당 영업 · 예약 TM · CRM 사전 정보 요약 · CRM 메모)와 `buildup_premeeting_runs`(창 · 건수 · 오류 코드). 전화 · 이메일 · 주소는 저장하지 않는다. RLS enable+force, anon/authenticated 권한 없음. `buildup_store_premeetings()`(security invoker, service_role만 실행)가 오늘~+30일 창을 한 트랜잭션으로 바꾼다: 창 밖 행 거부, CRM에서 사라진 창 안 일정은 `removed_at`, 저장 건수 = 받은 건수 확인. 30일 지난 행 삭제는 Edge Function이 조직 범위로 한다.
- 업데이트: pg_cron `pocket-buildup-premeetings` `0 23 * * *`(UTC = 매일 08:00 KST) → Edge Function `kpi-buildup-premeetings`(verify_jwt + 기존 내부 예약 비밀 `x-kpi-cron-secret` 재사용, 직원 · 브라우저 경로 없음). CRM 토큰은 서버 비밀 `CRM_BEARER_TOKEN`. CRM 응답이 한 페이지(1000건)를 채우면 잘린 것으로 보고 실패 처리(남은 일정을 지우지 않음). 응답 · 실행 기록에는 건수와 짧은 오류 코드만.
- 읽기: `kpi-buildup-api` `premeetings`(직원 세션 + ACTIVE 멤버십 + 빌드업 사용 가능 + 임시 비밀번호 아님) → 오늘(KST) 이후 · 사라지지 않은 일정, 마지막 성공 업데이트 시각. 이미 이 일정으로 만든 상담이 있으면 표시(누가 만들었는지 이름은 OWNER/ADMIN에게만). 연결 다리에 인자 없는 `premeetings` 한 가지만 추가. 상담 요약 허용 키에 `crm`(일정 번호) 추가.
- 화면(인텔리전스 v4.9 웹 빌드): 「프로젝트 전체 보기」 위에 `곧 미팅할 프리미팅 N건 · 오늘 · 7일 안 · 상담 준비 전 · 마지막 업데이트` 줄, 표에 아직 상담이 없는 일정이 점선 `CRM` 줄로 미팅일 순서대로 섞여 보이고(`CRM 예정` 거르기 칩), 캘린더에도 표시. 「상담 준비」는 CRM 정보로 채운 TM 사전 입력(회사명 · 신청자 · 미팅 일시 · TM 담당 · 사전 정보 글)을 열고, 만든 상담은 일정 번호로 이어져 CRM 줄 대신 상담 줄(작은 CRM 표시)로 보인다. TM 입력의 날짜 · 시간 칸을 넓혔다.
- 검증(로컬): `buildup-premeetings` 8개 테스트(창 · KST 경계 · 정규화 · 연락처 제외 · 정렬/중복 · 응답/동기화 형태 · 함수 인증 순서 · 마이그레이션 권한 · API/다리 경로) 포함 전체 테스트 통과(환경 실패 1 제외). 인텔리전스 웹 하네스 43/43(CRM 11개 흐름: 요약 · 3줄 · 다른 직원 준비 표시 · 날짜순 · 거르기 · 캘린더 · TM 미리 채움 2 · 서버 저장 링크 · 상담 줄로 바뀜 · 관리자 이름), 키 파일 모드 6/6, 단위 테스트 통과.
- 운영 상태: 아래 「배포 기록」 참고.

### 배포 기록 — CRM 프리미팅

- 2026-10-20 19:43 KST 운영 반영. 하나로 묶은 마이그레이션은 승인창이 닫혀(DELETE가 든 함수 본문이 확인 대상) 네 개로 나눠 적용: `20261020104259_buildup_upcoming_premeetings_tables`, `20261020104325_buildup_upcoming_premeetings_privileges`(anon/authenticated 권한 회수 — 기본 권한으로 REFERENCES·TRIGGER·TRUNCATE가 붙어 있었음), `20261020104416_buildup_store_premeetings_function`(30일 지난 행 삭제는 함수 밖, Edge Function이 조직 범위로 수행), `20261020104429_buildup_premeetings_schedule`. 저장소 파일도 같은 네 개로 맞췄다.
- 확인: 표 권한 postgres·service_role만, 함수 security invoker · EXECUTE는 postgres·service_role만, pg_cron `pocket-buildup-premeetings` `0 23 * * *` 활성. 합성 행으로 저장 함수 검증(2건 저장 → 1건으로 다시 저장 시 1건 removed · 창 밖 행 `premeeting_outside_window`) 후 예외로 롤백, 표 0건 확인.
- `kpi-buildup-premeetings` v1 ACTIVE(verify_jwt), `kpi-buildup-api` v3 ACTIVE(`premeetings` · `crm` 요약 키). 합성 프로브: 비밀 없음/틀린 비밀 401 `unauthorized`(실행 기록 생기지 않음), 인증 없는 `premeetings` 401 `login_required`.
- 오늘 목록 적재: 예약 작업 명령을 `trigger=manual`로 한 번 실행 → run #1 COMPLETED, 창 2026-10-20~2026-11-19, CRM 21건 = 저장 21건, 건너뜀 0, 2.5초. 날짜별 10/20 3 · 10/21 6 · 10/22 5 · 10/23 2 · 10/24 1 · 10/27 4. 오늘 KPI 원본(아침 동기화)의 4건 중 3건 일치, 나머지 1건은 그 뒤 CRM에서 10/22로 옮겨진 일정이라 10/22에 있다(건수 · 날짜만 확인, 회사명 미출력).
- 미검증: 실제 직원 화면에서 목록 · 상담 준비(프런트엔드는 PR 병합 후 배포), 내일 08:00 자동 실행(다음 실행 2026-10-21 08:00 KST).

## 빌드업 인텔리전스 v4.9 — AI 인사이트를 Claude Opus 5.5로 (2026-10-20)

- 사용자 요청: 빌드업 인텔리전스의 AI 인사이트 기능을 Opus 5.5 API로 연동.
- 자산: `src/assets/buildup-intelligence.html` = 인텔리전스 v4.9 웹 빌드(`포켓_빌드업_인텔리전스_v4.9_web.html`, CRM 프리미팅 · 화면 크기 조정 · KPI TM 메모 · 녹음 서버 보관 · 정밀 받아쓰기 · 목록 날짜 묶음 포함 최종본) 바이트 동일 복사본, SHA-256 `289875905f06383b4898011603c9da2a6a4e4dd04a330d88da66ca5f7012aa3c`.
- 화면 크기 · 왼쪽 목록(사용자 시안, 2026-10-20): 버튼 48→40px(글자 15) · 입력창 50→40 · 작은 버튼 36→32 · 버튼 모서리 4 · 테두리 옅게(영업자료 장면 버튼만 48 유지). 왼쪽 패널 272→292px — 머리(제목 · 개수 · 28px 채운 아이콘 버튼), `새 미팅`(채운 버튼) · `TM 사전 입력` 같은 너비 + 구분선, 목록 줄은 패널 끝까지(고른 줄 옅은 파랑 · 호버 회색 + 제목 파랑 · 상태 칩은 색 있는 줄에서 흰 바탕), `오늘 미팅 | 26년 10월 20일 (화)`, 줄마다 이름 · 상태 / BM 한 줄(없으면 `OOO 대표` · `정보 입력 전`) / 업종(`업종 선택 안함`) · 매출 구간. 목록 요약에 업종 id `sector`를 더했다(서버 `cleanSummary` 허용 키 추가, 예전 요약에는 업종 칸을 비워 둔다). `kpi-buildup-api` v4 운영 반영 2026-10-20 21:45 KST — 합성 프로브 401(세션 없음 `login_required` · 형식 오류 토큰은 게이트웨이), 반영 직후 직원 요청 200 확인(상태 코드 · 건수만 확인).
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
