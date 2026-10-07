// Existing UI state is evidence of the last operation, not a service uptime probe.
export function connectionPresentation(state = '') {
  const detail = String(state || '상태 확인 전');
  if (/실패|충돌|배포 필요/.test(detail)) return { ok: false, label: 'Supabase 확인 필요', detail };
  if (/로컬|캐시|대기|저장 중|불러오는|확인 중|로드 전/.test(detail)) return { ok: false, label: 'Supabase 확인 중', detail };
  if (/저장됨|저장 확인|데이터 확인됨|반영됨|반영·저장됨/.test(detail)) return { ok: true, label: 'Supabase 조회·저장 확인', detail };
  return { ok: false, label: 'Supabase 상태 미확인', detail };
}
