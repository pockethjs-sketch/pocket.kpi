import { SUPABASE_URL, employeeHeaders } from '../employeeSession.js';

// Employee account administration and first-login password change (kpi-account-api).
// Passwords are sent only in the request body to the Edge Function and are never stored in the browser.
const ENDPOINT = `${SUPABASE_URL}/functions/v1/kpi-account-api`;

export async function accountRequest(action, body = {}) {
  let headers;
  try { headers = await employeeHeaders(); } catch { throw Object.assign(new Error('login_required'), { code: 'login_required' }); }
  let response;
  try {
    response = await fetch(ENDPOINT, { method: 'POST', cache: 'no-store', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, action }) });
  } catch { throw Object.assign(new Error('network'), { code: 'network' }); }
  let result = null;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok || !result || result.error) {
    const code = result?.error || (response.status === 404 ? 'not_deployed' : `http_${response.status}`);
    throw Object.assign(new Error(code), { code });
  }
  return result;
}

export const ACCOUNT_ERROR_TEXT = {
  weak_password: '비밀번호는 12자 이상이어야 하고 같은 글자만 반복할 수 없습니다.',
  invalid_temp_password: '임시 비밀번호는 8자 이상이어야 합니다(앞뒤 공백 없이).',
  invalid_email: '이메일 형식을 확인하세요.',
  account_exists: '이미 가입된 이메일입니다. 기존 직원 등록(설정)에서 권한을 주거나 다른 이메일을 쓰세요.',
  role_not_allowed: '이 권한은 MASTER만 지정할 수 있습니다.',
  account_protected: 'MASTER · 소유자 계정과 내 계정은 여기서 바꿀 수 없습니다.',
  password_change_required: '먼저 내 비밀번호를 새로 정해야 합니다.',
  admin_required: 'MASTER 또는 관리자만 계정을 관리할 수 있습니다.',
  login_required: '로그인이 끝났습니다. 다시 로그인하세요.',
  not_deployed: '계정 서버가 아직 준비되지 않았습니다.',
  network: '서버에 연결하지 못했습니다. 네트워크를 확인하세요.',
};

export const accountErrorText = (error, fallback = '처리하지 못했습니다. 다시 시도하세요.') => ACCOUNT_ERROR_TEXT[error?.code || error?.message] || fallback;
