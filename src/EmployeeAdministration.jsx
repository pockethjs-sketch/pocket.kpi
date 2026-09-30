import React, { useEffect, useState } from 'react';
export default function EmployeeAdministration() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('EDITOR');
  const [scope, setScope] = useState('premeeting');
  const [employees, setEmployees] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const scopeAvailable = ['all', 'premeeting'].includes(window.kpiEmployeeAccess?.scope);
  const load = async () => { const data = await window.kpiEmployeeRequest('employees'); setEmployees(data.employees || []); };
  useEffect(() => { load().catch(() => setMessage('계정 목록을 불러오지 못했습니다. 다시 조회해주세요.')); }, []);
  async function register(e) {
    e.preventDefault(); if (busy) return;
    if (scope === 'premeeting' && !scopeAvailable) { setMessage('전용 계정 권한의 서버 적용이 대기 중입니다. 전체 권한 계정으로 대신 등록하지 않습니다.'); return; }
    setBusy(true); setMessage('');
    try {
      await window.kpiEmployeeRequest('employees', { email, role, scope }); setEmail('');
      setMessage('권한 등록 완료. 직원이 로그인 화면에서 이메일·본인 비밀번호를 입력하고 「처음 사용 · 이메일 인증」을 진행하면 됩니다.');
      await load();
    } catch (error) {
      setMessage(error.message === 'employee_already_approved' ? '이미 등록된 이메일입니다. 기존 권한은 변경하지 않았습니다.' : '계정 처리 실패. 목록을 다시 조회해 등록 여부를 확인해주세요.');
    } finally { setBusy(false); }
  }
  const field = 'border border-slate-200 rounded-lg px-3 py-2.5 w-full bg-white text-sm mt-2';
  return <section className="p-5 sm:p-7 bg-white border border-slate-200 rounded-xl space-y-5">
    <div><h2 className="font-extrabold text-xl text-slate-900">계정 생성</h2><p className="text-sm text-slate-500 mt-2">이메일과 업무 권한을 먼저 등록합니다. 비밀번호는 직원 본인이 설정하며, 최초 이메일 인증 후 사용합니다.</p></div>
    <form onSubmit={register} className="grid md:grid-cols-3 gap-4">
      <label className="text-sm font-semibold">로그인 이메일<input className={field} type="email" required autoComplete="off" placeholder="직원 이메일" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="text-sm font-semibold">접근 범위<select className={field} value={scope} onChange={e => { setScope(e.target.value); if (e.target.value === 'premeeting' && role === 'ADMIN') setRole('EDITOR'); }}><option value="premeeting">프리미팅 기업 전용</option><option value="all">전체 업무 메뉴</option></select></label>
      <label className="text-sm font-semibold">허용 작업<select className={field} value={role} onChange={e => setRole(e.target.value)}><option value="EDITOR">조회 · 수정 · 동기화</option><option value="VIEWER">조회만</option>{scope === 'all' && <option value="ADMIN">관리자 · 계정 생성 포함</option>}</select></label>
      <p className="md:col-span-2 text-sm text-slate-500">{scope === 'premeeting' ? '프리미팅 기업의 업체·결제·활동기록과 해당 동기화만 허용합니다. 다른 메뉴·광고·전체 유입 DB·계정 관리 API는 차단합니다.' : '전체 업무 데이터에 접근합니다. 계정 생성은 관리자만 가능합니다.'}</p>
      <button className="bg-indigo-600 text-white px-4 py-2.5 rounded-lg disabled:opacity-40" disabled={busy || (scope === 'premeeting' && !scopeAvailable)}>{busy ? '등록 중…' : '계정 권한 등록'}</button>
    </form>
    {!scopeAvailable && <p className="text-sm text-amber-700">프리미팅 전용 권한은 서버 보안 변경 승인 대기 중입니다. 전용 계정 등록은 아직 활성화되지 않았습니다.</p>}
    <p role="status" className="text-sm text-indigo-700 whitespace-pre-wrap">{message}</p>
    <div className="flex justify-between items-center"><h3 className="font-bold">등록된 직원 계정</h3><button type="button" className="border rounded-lg px-3 py-1.5 text-sm" onClick={() => load().catch(() => setMessage('계정 목록 조회 실패'))}>다시 조회</button></div>
    <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-slate-50"><tr><th className="p-3">이메일</th><th>접근 범위</th><th>권한</th><th>등록 상태</th></tr></thead><tbody>{employees.map(employee => <tr className="border-b" key={employee.email}><td className="p-3">{employee.email}</td><td>{employee.access_scope === 'premeeting' ? '프리미팅 기업 전용' : '전체 업무'}</td><td>{({ EDITOR:'조회·수정·동기화', VIEWER:'조회만', ADMIN:'관리자' })[employee.role] || employee.role}</td><td>{employee.claimed_user_id ? '인증 계정 연결됨' : '본인 가입·이메일 인증 대기'}</td></tr>)}</tbody></table></div>
    {!employees.length && <p className="text-sm text-slate-500">등록된 직원 계정이 없습니다. MASTER 계정은 별도로 유지됩니다.</p>}
  </section>;
}
