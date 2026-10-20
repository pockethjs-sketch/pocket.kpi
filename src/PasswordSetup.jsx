import React, { useState } from 'react';
import { accountRequest, accountErrorText } from './data/accountApi.js';

// First login with an administrator-set temporary password: the employee chooses their own
// password before the KPI and buildup workspaces load. Nothing is kept in browser storage.
export default function PasswordSetup({ account, onDone, onSignOut }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const long = password.length >= 12, same = !!password && password === confirm;
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!long) { setMessage('비밀번호는 12자 이상으로 정하세요.'); return; }
    if (!same) { setMessage('두 칸의 비밀번호가 같지 않습니다.'); return; }
    setBusy(true); setMessage('');
    try {
      await accountRequest('change_password', { password });
      setPassword(''); setConfirm('');
      setMessage('새 비밀번호를 저장했습니다. 다음부터는 이 비밀번호로 로그인하세요.');
      onDone();
    } catch (error) {
      setMessage(accountErrorText(error, '비밀번호를 바꾸지 못했습니다. 다시 시도하세요.'));
    } finally { setBusy(false); }
  }
  return <div className="min-h-screen bg-slate-900 flex items-center justify-center p-5"><form className="bg-white rounded-md p-7 max-w-md w-full space-y-4" onSubmit={submit}>
    <h1 className="text-xl font-bold">새 비밀번호 정하기</h1>
    <p className="text-sm text-slate-600">{account?.email ? <><b>{account.email}</b> · </> : null}처음 로그인했습니다. 관리자가 정한 임시 비밀번호 대신 본인만 아는 비밀번호를 정해야 업무 화면이 열립니다.</p>
    <label className="block text-sm">새 비밀번호<input className="block w-full border rounded p-2 mt-1" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    <label className="block text-sm">새 비밀번호 확인<input className="block w-full border rounded p-2 mt-1" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
    <ul className="text-xs text-slate-600 space-y-1">
      <li className={long ? 'text-emerald-700' : ''}>{long ? '✓' : '·'} 12자 이상</li>
      <li className={same ? 'text-emerald-700' : ''}>{same ? '✓' : '·'} 두 칸이 같음</li>
    </ul>
    <button disabled={busy} className="bg-blue-600 text-white rounded p-2 w-full disabled:opacity-50">{busy ? '저장 중…' : '새 비밀번호 저장하고 시작'}</button>
    <p className="text-xs text-slate-600" role="status">{message}</p>
    <button type="button" className="text-xs underline" onClick={onSignOut}>로그아웃</button>
  </form></div>;
}
