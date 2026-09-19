import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { employeeAuth, employeeHeaders, employeeRequest, scopedEmployeeStorage } from './employeeSession.js';
import { isMasterLoginAlias, isPlausibleEmail, resolveEmployeeLoginEmail } from './data/masterLoginAlias.js';
import './styles.css';

const MASTER_EMAIL_STORAGE_KEY = 'pocket-kpi:master-login-email:v1';

function EmployeeEntry() {
  const [loginId, setLoginId] = useState('');
  const [masterEmail, setMasterEmail] = useState(() => window.localStorage.getItem(MASTER_EMAIL_STORAGE_KEY) || '');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('직원 로그인 확인 중…');
  const [busy, setBusy] = useState(false);
  const [LoadedApp, setLoadedApp] = useState(null);
  useEffect(() => {
    let alive = true, currentUser = '', checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const { data } = await employeeAuth.auth.getSession();
        if (!data.session) { if (alive) { setLoadedApp(null); setMessage('승인된 직원 이메일로 로그인하세요.'); } return; }
        const access = await employeeRequest('session');
        if (!alive) return;
        if (currentUser && currentUser !== access.userId) { location.reload(); return; }
        currentUser = access.userId;
        window.kpiEmployeeAccess = access;
        window.kpiEmployeeStorage = scopedEmployeeStorage(window.localStorage, access.userId);
        window.kpiEmployeeHeaders = employeeHeaders;
        window.kpiEmployeeRequest = employeeRequest;
        window.kpiSignOut = async () => {
          // Never clear unsaved journals on sign out. A full reload drops all in-memory CRM state.
          await employeeAuth.auth.signOut({ scope: 'local' });
          location.reload();
        };
        const { default: App } = await import('./main.jsx');
        if (alive) { setLoadedApp(() => App); setMessage(''); }
      } catch (error) {
        if (alive) { setLoadedApp(null); setMessage(error.message === 'employee_approval_required' ? '이메일 인증 후 관리자 승인이 필요합니다.' : `로그인 확인 실패: ${error.message}`); }
      } finally { checking = false; }
    };
    check();
    const { data: listener } = employeeAuth.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { if (currentUser) location.reload(); else { setLoadedApp(null); setMessage('로그아웃되었습니다.'); } }
      else setTimeout(check, 0);
    });
    const timer = setInterval(check, 60_000);
    const focus = () => check();
    window.addEventListener('focus', focus);
    return () => { alive = false; clearInterval(timer); listener.subscription.unsubscribe(); window.removeEventListener('focus', focus); };
  }, []);

  async function submit(signup) {
    const masterAlias = isMasterLoginAlias(loginId);
    const email = resolveEmployeeLoginEmail(loginId, masterEmail);
    if (!isPlausibleEmail(email)) {
      setMessage(masterAlias ? 'MASTER 최초 1회는 아래에 승인된 관리자 이메일을 연결해야 합니다.' : '올바른 이메일 또는 MASTER를 입력하세요.');
      return;
    }
    if (signup && password.length < 12) {
      setMessage('처음 설정하는 비밀번호는 12자 이상이어야 합니다.');
      return;
    }
    setBusy(true);
    try {
      const credentials = { email, password };
      const result = signup ? await employeeAuth.auth.signUp({ ...credentials, options: { emailRedirectTo: location.origin + import.meta.env.BASE_URL } }) : await employeeAuth.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      if (masterAlias) window.localStorage.setItem(MASTER_EMAIL_STORAGE_KEY, email);
      setPassword('');
      setMessage(signup ? '관리자 이메일의 인증 링크를 누르세요. 인증이 끝나면 이 브라우저에서 MASTER로 로그인할 수 있습니다.' : '권한 확인 중…');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  if (LoadedApp) return <LoadedApp />;
  return <div className="min-h-screen bg-slate-900 flex items-center justify-center p-5"><form className="bg-white rounded-md p-7 max-w-md w-full space-y-4" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
    <h1 className="text-xl font-bold">포켓 KPI · MASTER / 직원 로그인</h1>
    <p className="text-sm text-slate-600">관리자는 계정명 MASTER 또는 승인된 이메일로 접속합니다.</p>
    <label className="block text-sm">계정명 또는 이메일<input className="block w-full border rounded p-2 mt-1" type="text" autoCapitalize="none" autoComplete="username" required value={loginId} onChange={(e) => setLoginId(e.target.value)} /></label>
    {isMasterLoginAlias(loginId) && <label className="block text-sm">MASTER 연결 이메일 · 최초 1회<input className="block w-full border rounded p-2 mt-1" type="email" autoComplete="email" placeholder="승인된 관리자 이메일" value={masterEmail} onChange={(e) => setMasterEmail(e.target.value)} /><span className="block mt-1 text-xs text-slate-500">공개 코드가 아니라 이 브라우저에만 저장됩니다.</span></label>}
    <label className="block text-sm">비밀번호<input className="block w-full border rounded p-2 mt-1" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    <button disabled={busy} className="bg-blue-600 text-white rounded p-2 w-full">{busy ? '확인 중…' : '로그인'}</button>
    <button type="button" disabled={busy || !isPlausibleEmail(resolveEmployeeLoginEmail(loginId, masterEmail)) || password.length < 12} className="border rounded p-2 w-full disabled:opacity-40" onClick={() => submit(true)}>{isMasterLoginAlias(loginId) ? 'MASTER 처음 연결 · 이메일 인증' : '처음 사용 · 이메일 인증'} (비밀번호 12자 이상)</button>
    <p className="text-xs text-slate-600" role="status">{message}</p>
    <button type="button" className="text-xs underline" onClick={() => employeeAuth.auth.signOut({ scope: 'local' })}>현재 로그인 해제</button>
  </form></div>;
}
document.getElementById('boot')?.remove();
createRoot(document.getElementById('root')).render(<EmployeeEntry />);
