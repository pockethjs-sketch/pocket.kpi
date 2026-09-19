import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { employeeAuth, employeeHeaders, employeeRequest, masterAliasRequest, scopedEmployeeStorage } from './employeeSession.js';
import { consumeMasterSetupToken, isMasterLoginAlias, isPlausibleEmail } from './data/masterLoginAlias.js';
import './styles.css';

const MASTER_SETUP_STORAGE_KEY = 'pocket-kpi:master-setup-token:v1';

function EmployeeEntry() {
  const [loginId, setLoginId] = useState('');
  const [masterSetupToken, setMasterSetupToken] = useState(() => consumeMasterSetupToken(window.location, window.history, window.sessionStorage));
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
    if (masterAlias) {
      if (password.length < 12) { setMessage('MASTER 비밀번호는 12자 이상이어야 합니다.'); return; }
      setBusy(true);
      try {
        await masterAliasRequest(masterSetupToken ? 'bootstrap' : 'login', password, masterSetupToken);
        if (masterSetupToken) {
          window.sessionStorage.removeItem(MASTER_SETUP_STORAGE_KEY);
          setMasterSetupToken('');
        }
        setPassword('');
        setMessage('MASTER 권한 확인 중…');
      } catch (error) {
        const messages = { invalid_credentials: 'MASTER 계정 또는 비밀번호를 확인하세요.', invalid_setup_link: 'MASTER 최초 설정 링크가 만료되었거나 올바르지 않습니다.', choose_new_password: '예전 MASTER 비밀번호는 노출 이력이 있어 재사용할 수 없습니다. 새 비밀번호를 정하세요.', master_already_configured: 'MASTER 최초 설정이 이미 끝났습니다. 일반 로그인으로 다시 접속하세요.' };
        setMessage(messages[error.message] || `MASTER 로그인 실패: ${error.message}`);
      } finally { setBusy(false); }
      return;
    }
    const email = String(loginId || '').trim().toLowerCase();
    if (!isPlausibleEmail(email)) { setMessage('올바른 직원 이메일 또는 MASTER를 입력하세요.'); return; }
    if (signup && password.length < 12) {
      setMessage('처음 설정하는 비밀번호는 12자 이상이어야 합니다.');
      return;
    }
    setBusy(true);
    try {
      const credentials = { email, password };
      const result = signup ? await employeeAuth.auth.signUp({ ...credentials, options: { emailRedirectTo: location.origin + import.meta.env.BASE_URL } }) : await employeeAuth.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      setPassword('');
      setMessage(signup ? '직원 이메일의 인증 링크를 누르세요. 가입만으로 접근 권한이 생기지는 않습니다.' : '권한 확인 중…');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  if (LoadedApp) return <LoadedApp />;
  return <div className="min-h-screen bg-slate-900 flex items-center justify-center p-5"><form className="bg-white rounded-md p-7 max-w-md w-full space-y-4" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
    <h1 className="text-xl font-bold">포켓 KPI · MASTER / 직원 로그인</h1>
    <p className="text-sm text-slate-600">MASTER는 이메일 인증 없이 계정명과 비밀번호로 접속합니다. 일반 직원만 승인된 이메일을 사용합니다.</p>
    <label className="block text-sm">계정명 또는 이메일<input className="block w-full border rounded p-2 mt-1" type="text" autoCapitalize="none" autoComplete="username" required value={loginId} onChange={(e) => setLoginId(e.target.value)} /></label>
    <label className="block text-sm">비밀번호<input className="block w-full border rounded p-2 mt-1" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    <button disabled={busy} className="bg-blue-600 text-white rounded p-2 w-full">{busy ? '확인 중…' : (isMasterLoginAlias(loginId) && masterSetupToken ? 'MASTER 최초 설정' : '로그인')}</button>
    {!isMasterLoginAlias(loginId) && <button type="button" disabled={busy || !isPlausibleEmail(loginId) || password.length < 12} className="border rounded p-2 w-full disabled:opacity-40" onClick={() => submit(true)}>처음 사용 · 이메일 인증 (비밀번호 12자 이상)</button>}
    {isMasterLoginAlias(loginId) && masterSetupToken && <p className="text-xs text-amber-700">일회용 최초 설정 링크입니다. 새 비밀번호를 정하면 이 링크는 다시 사용할 수 없습니다.</p>}
    <p className="text-xs text-slate-600" role="status">{message}</p>
    <button type="button" className="text-xs underline" onClick={() => employeeAuth.auth.signOut({ scope: 'local' })}>현재 로그인 해제</button>
  </form></div>;
}
document.getElementById('boot')?.remove();
createRoot(document.getElementById('root')).render(<EmployeeEntry />);
