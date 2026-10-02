export const AUTH_TIMEOUT_MS = 20_000;

// Includes response-body download, not just receipt of HTTP headers. Never retries writes.
export function createAuthFetch(fetcher = globalThis.fetch, timeoutMs = AUTH_TIMEOUT_MS) {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const signal = init.signal || input?.signal;
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(input, { ...init, signal: controller.signal });
          const bytes = await response.arrayBuffer();
          return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
            status: response.status, statusText: response.statusText, headers: response.headers,
          });
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('auth_network_timeout'));
            controller.abort();
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}

// A stuck SDK storage/refresh lock cannot be cancelled safely: require a page reload.
export async function boundedAuthOperation(operation, timeoutMs = 30_000) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('auth_session_timeout')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export function loginErrorMessage(error) {
  const code = error?.code || error?.message;
  if (code === 'invalid_credentials' || error?.message === 'Invalid login credentials') return '이메일 또는 비밀번호가 맞지 않습니다. 기존 계정은 ‘처음 사용’이 아니라 로그인 버튼을 사용하세요.';
  if (code === 'email_not_confirmed') return '이메일 인증이 완료되지 않았습니다. 인증 메일의 링크를 확인하세요.';
  if (code === 'auth_session_timeout') return '로그인 세션 처리가 멈췄습니다. ‘로그인 화면 다시 불러오기’를 누른 뒤 다시 로그인하세요. 저장 중이던 입력은 지우지 않습니다.';
  if (/auth_network_timeout|Failed to fetch|NetworkError|Load failed/i.test(error?.message || '')) return '로그인 서버 응답이 지연되거나 연결되지 않았습니다. 요청을 종료했습니다. 네트워크를 확인한 뒤 로그인 버튼을 다시 눌러주세요.';
  return error?.message || '로그인에 실패했습니다. 다시 시도해 주세요.';
}
