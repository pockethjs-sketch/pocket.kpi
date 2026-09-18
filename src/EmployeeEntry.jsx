import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { employeeAuth, employeeHeaders, employeeRequest, scopedEmployeeStorage } from './employeeSession.js';
import './styles.css';

function EmployeeEntry() {
  const [email, setEmail] = useState('');
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
    setBusy(true);
    try {
      const credentials = { email: email.trim(), password };
      const result = signup ? await employeeAuth.auth.signUp({ ...credentials, options: { emailRedirectTo: location.origin + import.meta.env.BASE_URL } }) : await employeeAuth.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      setPassword('');
      setMessage(signup ? '이메일의 인증 링크를 누른 뒤 이 페이지에서 로그인하세요. 가입만으로 데이터 접근 권한은 생기지 않습니다.' : '권한 확인 중…');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  if (LoadedApp) return <LoadedApp />;
  return <div className="min-h-screen bg-slate-900 flex items-center justify-center p-5"><form className="bg-white rounded-md p-7 max-w-md w-full space-y-4" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
    <h1 className="text-xl font-bold">포켓 KPI · 직원 로그인</h1>
    <p className="text-sm text-slate-600">기존 공용 계정 대신 이메일 인증과 관리자 승인을 사용합니다.</p>
    <label className="block text-sm">이메일<input className="block w-full border rounded p-2 mt-1" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label className="block text-sm">비밀번호<input className="block w-full border rounded p-2 mt-1" type="password" autoComplete="current-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    <button disabled={busy} className="bg-blue-600 text-white rounded p-2 w-full">{busy ? '확인 중…' : '로그인'}</button>
    <button type="button" disabled={busy || !email || password.length < 12} className="border rounded p-2 w-full disabled:opacity-40" onClick={() => submit(true)}>처음 사용 · 이메일 인증 (비밀번호 12자 이상)</button>
    <p className="text-xs text-slate-600" role="status">{message}</p>
    <button type="button" className="text-xs underline" onClick={() => employeeAuth.auth.signOut({ scope: 'local' })}>현재 로그인 해제</button>
  </form></div>;
}
document.getElementById('boot')?.remove();
createRoot(document.getElementById('root')).render(<EmployeeEntry />);
