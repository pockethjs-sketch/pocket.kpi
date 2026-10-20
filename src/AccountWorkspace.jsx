import React, { useEffect, useState } from 'react';
import { accountRequest, accountErrorText } from './data/accountApi.js';

// MASTER/ADMIN account administration: create employee accounts with a temporary password,
// reset it, change role and pause/resume access. The server re-checks every rule (kpi-account-api).
const ROLE_NAME = { OWNER: '소유자 · MASTER', ADMIN: '관리자 · 계정 관리', EDITOR: '조회 · 수정', VIEWER: '조회만' };
const when = (value) => value ? new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

export default function AccountWorkspace() {
  const [data, setData] = useState({ accounts: [], pending: [], role: '' });
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ email: '', name: '', role: 'EDITOR', password: '' });
  const [edit, setEdit] = useState(null); // { userId, kind: 'password' | 'name', value }

  async function load() {
    try { const result = await accountRequest('accounts'); setData({ accounts: result.accounts || [], pending: result.pending || [], role: result.role || '' }); setLoaded(true); }
    catch (error) { setLoaded(true); setMessage(accountErrorText(error, '계정 목록을 불러오지 못했습니다. 다시 조회하세요.')); }
  }
  useEffect(() => { load(); }, []);
  const owner = data.role === 'OWNER';

  async function run(key, action, body, done) {
    if (busy) return false;
    setBusy(key); setMessage('');
    try { await accountRequest(action, body); setMessage(done); setEdit(null); await load(); return true; }
    catch (error) { setMessage(accountErrorText(error)); return false; }
    finally { setBusy(''); }
  }
  function create(event) {
    event.preventDefault();
    const email = form.email.trim().toLowerCase();
    run('create', 'create_account', { ...form, email }, `${email} 계정을 만들었습니다. 임시 비밀번호를 직원에게 따로 전달하세요. 처음 로그인하면 본인 비밀번호를 정해야 합니다.`)
      .then((ok) => { if (ok) setForm((value) => ({ ...value, email: '', name: '', password: '' })); });
  }
  function toggle(account) {
    const next = !account.active;
    if (!next && !window.confirm(`${account.email} 계정을 사용 중지할까요? 바로 로그인과 업무 화면 사용이 막힙니다. 다시 사용으로 되돌릴 수 있습니다.`)) return;
    run(account.userId, 'update_account', { userId: account.userId, active: next }, next ? `${account.email} 계정을 다시 사용합니다.` : `${account.email} 계정을 사용 중지했습니다.`);
  }

  const accounts = data.accounts;
  return <div className="account-admin">
    <header className="account-head">
      <div><h1>계정 관리</h1><p>MASTER와 관리자만 보는 화면입니다. 직원 계정을 만들고 임시 비밀번호 · 권한 · 사용 여부를 관리합니다.</p></div>
      <button type="button" className="account-ghost" onClick={() => { setMessage(''); load(); }}>다시 조회</button>
    </header>

    <form className="account-card account-create" onSubmit={create}>
      <h2>계정 추가</h2>
      <div className="account-grid">
        <label>로그인 이메일<input type="email" required autoComplete="off" placeholder="name@pocket.company" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>이름(선택)<input type="text" maxLength={40} autoComplete="off" placeholder="비우면 이메일 앞부분" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>권한<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="EDITOR">{ROLE_NAME.EDITOR}</option><option value="VIEWER">{ROLE_NAME.VIEWER}</option>{owner && <option value="ADMIN">{ROLE_NAME.ADMIN}</option>}
        </select></label>
        <label>임시 비밀번호<input type="text" required minLength={8} autoComplete="off" spellCheck={false} placeholder="8자 이상" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        <button className="account-primary" disabled={!!busy}>{busy === 'create' ? '만드는 중…' : '계정 만들기'}</button>
      </div>
      <p className="account-hint">임시 비밀번호는 직원에게 따로 전달하세요. 직원이 처음 로그인하면 본인만 아는 비밀번호(12자 이상)를 정해야 업무 화면이 열립니다. 이메일 인증은 필요 없습니다.</p>
    </form>

    {message && <p className="account-message" role="status">{message}</p>}

    <section className="account-card">
      <h2>계정 <span>{accounts.length}</span></h2>
      {!loaded ? <p className="account-hint">불러오는 중…</p> : <div className="account-table-wrap"><table className="account-table">
        <thead><tr><th scope="col">이름 · 이메일</th><th scope="col">권한</th><th scope="col">상태</th><th scope="col">비밀번호</th><th scope="col">마지막 로그인</th><th scope="col"><span className="account-sr">관리</span></th></tr></thead>
        <tbody>{accounts.map((account) => {
          const editing = edit && edit.userId === account.userId ? edit : null;
          return <tr key={account.userId} className={account.active ? '' : 'is-paused'}>
            <th scope="row"><b>{account.name}{account.self && <em>나</em>}</b><small>{account.email}</small></th>
            <td>{account.manageable
              ? <select aria-label={`${account.email} 권한`} value={account.role} disabled={!!busy} onChange={(e) => run(account.userId, 'update_account', { userId: account.userId, role: e.target.value }, `${account.email} 권한을 ${ROLE_NAME[e.target.value]}(으)로 바꿨습니다.`)}>
                  <option value="EDITOR">{ROLE_NAME.EDITOR}</option><option value="VIEWER">{ROLE_NAME.VIEWER}</option>{(owner || account.role === 'ADMIN') && <option value="ADMIN">{ROLE_NAME.ADMIN}</option>}
                </select>
              : <span>{ROLE_NAME[account.role] || account.role}</span>}</td>
            <td><span className={account.active ? 'account-on' : 'account-off'}>{account.active ? '사용 중' : '사용 중지'}</span></td>
            <td>{account.master ? <span className="account-muted">MASTER 전용 로그인</span> : account.mustChangePassword ? <span className="account-temp">임시 · 첫 로그인 때 변경</span> : <span>본인이 정함</span>}</td>
            <td>{account.lastSignInAt ? when(account.lastSignInAt) : <span className="account-muted">아직 없음</span>}</td>
            <td className="account-actions">{!account.manageable ? <span className="account-muted">{account.self ? '내 계정' : '변경 불가'}</span>
              : editing ? <form onSubmit={(e) => {
                  e.preventDefault();
                  if (editing.kind === 'password') run(account.userId, 'reset_password', { userId: account.userId, password: editing.value }, `${account.email} 비밀번호를 임시 비밀번호로 바꿨습니다. 다음 로그인 때 새 비밀번호를 정하게 됩니다.`);
                  else run(account.userId, 'update_account', { userId: account.userId, name: editing.value }, `${account.email} 이름을 바꿨습니다.`);
                }}>
                  <input autoFocus type="text" spellCheck={false} autoComplete="off" required minLength={editing.kind === 'password' ? 8 : 1} maxLength={editing.kind === 'password' ? 72 : 40}
                    aria-label={editing.kind === 'password' ? '새 임시 비밀번호' : '이름'} placeholder={editing.kind === 'password' ? '새 임시 비밀번호(8자 이상)' : '이름'} value={editing.value} onChange={(e) => setEdit({ ...editing, value: e.target.value })} />
                  <button className="account-primary sm" disabled={!!busy}>{editing.kind === 'password' ? '초기화' : '저장'}</button>
                  <button type="button" className="account-ghost sm" onClick={() => setEdit(null)}>취소</button>
                </form>
              : <>
                  <button type="button" className="account-ghost sm" disabled={!!busy} onClick={() => setEdit({ userId: account.userId, kind: 'password', value: '' })}>임시 비밀번호</button>
                  <button type="button" className="account-ghost sm" disabled={!!busy} onClick={() => setEdit({ userId: account.userId, kind: 'name', value: account.name })}>이름</button>
                  <button type="button" className={account.active ? 'account-danger sm' : 'account-ghost sm'} disabled={!!busy} onClick={() => toggle(account)}>{account.active ? '사용 중지' : '다시 사용'}</button>
                </>}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    </section>

    {data.pending.length > 0 && <section className="account-card">
      <h2>가입 대기 <span>{data.pending.length}</span></h2>
      <p className="account-hint">설정의 「직원 등록」으로 이메일만 등록하고 아직 가입하지 않은 계정입니다. 임시 비밀번호로 바로 만들 수도 있습니다.</p>
      <ul className="account-pending">{data.pending.map((item) => <li key={item.email}>
        <span><b>{item.email}</b><small>{ROLE_NAME[item.role] || item.role} · 등록 {when(item.createdAt)}</small></span>
        <button type="button" className="account-ghost sm" onClick={() => { setForm({ email: item.email, name: '', role: item.role === 'ADMIN' && !owner ? 'EDITOR' : item.role, password: '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>임시 비밀번호로 만들기</button>
      </li>)}</ul>
    </section>}
  </div>;
}
