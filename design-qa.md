# 잔금 관리 — 노션형 표 QA (2026-09-28)

이전 계약 총괄 QA 기록은 [2026-09-15 보관본](docs/design-qa-20260915.md)에 보존했다.

final result: blocked

배포 요청: 사용자가 미리보기를 확인한 뒤 2026-09-28 실제 데이터에 이 화면을 반영하도록 승인했다. 아래 남은 검증 범위를 완료한 것으로 바꾸지는 않는다. 가상 데이터는 배포 대상이 아니다.

## 2026-09-28 미리보기 요청 후 추가 검증

- 사용자 화면 표시 요청에 따라 가상 데이터 전용 로컬 fixture를 실행했다. 임시 프로필의 headless Chrome/CDP만 사용하고 사용자의 브라우저 프로필·로그인·운영 API는 접근하지 않았다.
- URL: `http://127.0.0.1:8776/pocket.kpi/artifacts/receivables-preview.html`
- 실제 구현 컴포넌트 캡처: `artifacts/receivables-preview-desktop.png` (1700×1100), `artifacts/receivables-preview-reference-width.png` (1463×873), `artifacts/receivables-preview-mobile.png` (390×844), deviceScaleFactor 1.
- 가상 8개 행/10개 열 표시, 입금 완료 분류 선택 시 2행 표시, 모바일 페이지 가로 넘침 없음(표 내부 가로 스크롤), 런타임 예외 0 확인.
- 원본 첨부와 1463px 캡처를 같은 이미지 입력으로 확인했다. 어두운 셀/태그/원문 줄바꿈은 반영됐으나 상단 분류를 유지해 표 시작 위치와 표시 행 수가 다르다. 1463px에서는 우측 입금 열을 보려면 표 가로 스크롤이 필요하다. 본문 글자 크기를 유지하기 위한 현재 제약이며 폭 조정 검토가 남는다.
- 현재 결과는 검토용 미리보기다. 운영 원장 편집 UI의 브라우저 검증과 상세 fidelity 검증은 완료하지 않았으므로 전체 QA 판정은 blocked 유지. 아래 초기 브라우저 미실행 기록은 이 절로 대체한다.

## 비교 대상과 상태

- Source visual truth: 사용자 첨부 `C:/Users/PK-INV~1/AppData/Local/Temp/codex-clipboard-475ffc6e-3c70-4eda-a896-14fe67c48e79.png` (대화에서 확인). 원본 고객 데이터는 테스트에 복제하지 않는다.
- Source dimensions: 첨부 표시 1463 × 873px. 원본 디바이스 밀도는 확인되지 않았다.
- Implementation: `src/NotionReceivables.jsx`, `src/ReceivablesTable.jsx`, `src/receivables-table.css`, `src/main.jsx`의 LtvExpansionView 원장.
- Implementation screenshot: 없음. Viewport/CSS size/deviceScaleFactor: 미검증. 비교용 데스크톱 목표 폭은 원본과 같은 1463px이며, 좁은 화면도 추가 확인 필요.
- State: 상단 분류 유지, Notion 원문 10열 / 운영 원장 11열(중도금 보존). 합성 데이터로만 테스트했다.

## Findings

- [P1 verification blocker] Browser 플러그인/스킬이 현재 작업에 없어 렌더링 캡처를 수행하지 못했다. 별도 Playwright 사용은 사용자에게 비차단 질문으로 요청했지만 승인 응답 전이다. 대체 브라우저는 승인 없이 실행하지 않았다.
- Full-view comparison evidence: 없음. 코드·SSR·빌드만으로 시각적 일치를 판정하지 않는다.
- Focused-region evidence: 없음. 긴 메모, 태그/상태 대비, 헤더 고정, 상태 선택과 결제 모달은 캡처 후 확인해야 한다.

## 필수 fidelity surfaces (아래는 구현 의도이며 시각 검증 결과가 아님)

1. Typography: 기존 Pretendard 계열 유지, 본문 14px/헤더 13px/상태 12px. 말줄임 제거 및 원문 줄바꿈. 실제 가독성 미검증.
2. Spacing/layout: 가느다란 셀 구분선, 상단 정렬, 날짜/프로젝트 독립 열. 표 내부 스크롤·고정 헤더. 작은 화면 페이지 overflow 및 실제 밀도 미검증.
3. Colors: #191919 바탕, #303030 구분선, 밝은 본문, 담당/프로젝트 색상 태그 및 분리된 입금 pill. 대조 캡처 미검증.
4. Assets: 기존 Lucide 패키지의 문서/속성/상태 아이콘 사용. 래스터 사진·로고가 필요 없는 데이터 표. 새 이미지 생성 없음.
5. Content: 원본 필드만 사용, 금액 텍스트 원형 유지. 없는 가이드 값은 —. 노션 요청 완료와 입금 완료는 독립. 운영 중도금 보존을 위해 원본보다 한 열 많음.

## 코드/합성 테스트 evidence

- `npm test`: 181 passed (6개 신규 UI 회귀 검사 포함).
- `npm run check`: security lint, production build, build-contract 통과. 기존 대형 main chunk 경고는 남아 있음.
- `npm run audit`: 0 vulnerabilities (샌드박스 네트워크 실패 후 허용된 재실행 성공).
- 테스트 범위: 10/11열, 원문 표시, 단계/검색/입금 필터, 더 보기, 새로고침 실패 시 마지막 정상 자료 유지, 요청완료와 입금완료 구분, 원본 링크 검증, 운영 수정/보관/기록/업체 버튼 연결.
- 실제 운영 인증·저장·조회와 브라우저 클릭/포커스/콘솔은 미검증. 데이터와 API는 변경하지 않았다.

## 비교 이력 / 후속 체크

- 시각 비교 iteration 0: 캡처 미실행. 성공 판정 없음.
- [ ] 승인된 테스트 브라우저로 합성 데이터 렌더, 원본과 동일 폭 캡처.
- [ ] 원본/구현을 같은 비교 입력으로 열어 전체 및 긴 텍스트/태그 영역 비교.
- [ ] 분류/필터/더 보기/스크롤/포커스/조회실패, 원장 편집 UI를 브라우저에서 확인.
- [ ] P0/P1/P2 수정 후 재캡처; 통과 전에 시각 QA 완료·배포 완료로 표시하지 않기.

운영 배포하지 않았으며 코드 변경본만 로컬에 존재한다.
