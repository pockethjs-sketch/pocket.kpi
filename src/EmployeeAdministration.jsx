import React, { useEffect, useState } from 'react';
export default function EmployeeAdministration() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('EDITOR');
  const [employees, setEmployees] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => { const data = await window.kpiEmployeeRequest('employees'); setEmployees(data.employees || []); };
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, []);
  async function approve(e) {
    e.preventDefault(); setBusy(true);
    try { await window.kpiEmployeeRequest('employees', { email, role }); setEmail(''); await load(); setMessage('승인됨. 직원이 자신의 이메일을 인증하고 로그인하면 접근할 수 있습니다.'); }
    catch(error) { setMessage(error.message); } finally { setBusy(false); }
  }
  return <div className="p-6 bg-white border rounded-md space-y-4"><h2 className="font-bold text-lg">직원 접근 승인</h2><p className="text-sm text-slate-500">서버에서 검증하는 실제 접근 권한입니다. 기존 MASTER/USER 공용 암호는 더 이상 사용하지 않습니다.</p>
    <form onSubmit={approve} className="flex flex-wrap gap-2"><input className="border rounded px-3 py-2" type="email" required placeholder="직원 이메일" value={email} onChange={(e) => setEmail(e.target.value)} /><select className="border rounded px-3" value={role} onChange={(e) => setRole(e.target.value)}><option value="EDITOR">업무 편집</option><option value="VIEWER">읽기 전용</option><option value="ADMIN">관리자</option></select><button className="bg-blue-600 text-white px-4 rounded disabled:opacity-40" disabled={busy}>접근 승인</button></form>
    <p role="status" className="text-sm">{message}</p><table className="w-full text-sm"><thead><tr className="text-left border-b"><th>이메일</th><th>권한</th><th>상태</th></tr></thead><tbody>{employees.map((employee) => <tr className="border-b" key={employee.email}><td className="py-3">{employee.email}</td><td>{employee.role}</td><td>{employee.claimed_user_id ? '인증 계정 연결됨' : '첫 로그인 대기'}</td></tr>)}</tbody></table>
    {window.localStorage.getItem('crm:pendingMutations:v1') && <p className="text-amber-700 text-sm">이 브라우저에 이전 공용 계정의 미저장 저널이 남아 있습니다. 원본은 보존했고 새 직원 계정으로 자동 전송하지 않습니다. 확인 후 별도 복구가 필요합니다.</p>}
  </div>;
}
