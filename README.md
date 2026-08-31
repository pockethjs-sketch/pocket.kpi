# Pocket KPI

포켓 KPI 웹 프런트엔드입니다. 운영 데이터는 기존 Google Sheets / Apps Script 저장 V3를 그대로 사용하며, 이 저장소는 화면 빌드와 GitHub Pages 배포만 담당합니다.

## 로컬 실행

```bash
npm ci
npm run dev
```

기본 주소는 `http://127.0.0.1:8765/pocket.kpi/`입니다.

## 검증

```bash
npm run check
npm run audit
```

`check`는 프로덕션 빌드 후 다음 호환 계약을 검사합니다.

- 기존 `localStorage` 데이터·저널 키
- Apps Script `meta` / `marketing` / `state` 읽기 경로
- 계약현황·잔금관리 핵심 화면
- 런타임 Babel·Tailwind CDN·React CDN 제거 여부
- JS/CSS 정적 자산 생성 여부

## 배포

`main`에 반영된 커밋은 `.github/workflows/deploy.yml`에서 빌드·검증 후 `dist`를 GitHub Pages에 배포합니다. GitHub 저장소의 Pages Source는 **GitHub Actions**로 설정되어 있어야 합니다.

Apps Script와 Google Sheets는 이 배포에 포함되지 않습니다. 프런트엔드 빌드 변경만으로 저장 백엔드 버전이나 시트 데이터는 바뀌지 않습니다.

## 롤백

GitHub Pages는 이전 정상 커밋을 다시 `main`에 적용해 재배포합니다. 저장 API·로컬 키·시트 구조는 기존 계약을 유지하므로 프런트엔드 롤백에 데이터 마이그레이션이 필요하지 않습니다.
