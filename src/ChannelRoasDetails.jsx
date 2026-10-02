import React from 'react';

const money = value => Number(value || 0).toLocaleString('ko-KR') + '원';

export default function ChannelRoasDetails({ rows, spend, roas, channel, periodLabel, onOpenLead }) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const sorted = [...rows].sort((a, b) => b.amount - a.amount || (b.lead.contractAt || '').localeCompare(a.lead.contractAt || ''));
  return <div className="space-y-4" data-testid="channel-roas-details">
    <p className="text-sm text-slate-600">{periodLabel} · {channel} · 계약일 기준 · 계약 완료 기업 {rows.length.toLocaleString()}곳</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[
        ['계약금액 합계', money(total)],
        ['광고비', spend == null ? '미확인' : money(spend)],
        ['계약금액 기준 ROAS', roas == null ? '산출 불가' : roas.toLocaleString('ko-KR') + '%'],
      ].map(([label, value]) => <div key={label} className="rounded-md border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-lg font-black tabular-nums text-slate-900">{value}</p></div>)}
    </div>
    <div className="rounded-md border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900">
      <p className="font-bold">계산식: {money(total)} ÷ {spend == null ? '광고비 미확인' : money(spend)} × 100 = {roas == null ? '산출 불가' : roas.toLocaleString('ko-KR') + '%'}</p>
      <p className="mt-1 text-xs leading-relaxed">아래 기업의 계약금액을 합산합니다. 실입금액 기준이 아니며, 유입일 기준인 표의 ‘결제 기업’ 수와 다를 수 있습니다. 계약금액이 없는 경우 결제 회차 합계를 사용합니다.</p>
      {roas == null && <p className="mt-1 text-xs">광고비가 0원이거나 미확인이어도 계약 기업 목록은 확인할 수 있습니다.</p>}
    </div>
    <div className="max-h-[480px] overflow-auto rounded-md border border-slate-200">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600"><tr>{['기업명', '유입 채널', '신규/기존', '계약일', '담당자', '계약금액'].map(label => <th key={label} className={'px-3 py-3 font-bold ' + (label === '계약금액' ? 'text-right' : '')}>{label}</th>)}</tr></thead>
        <tbody>{sorted.map(({ lead, amount, customerType }, index) => <tr key={lead.id || index} className="border-t border-slate-100 hover:bg-slate-50">
          <td className="px-3 py-3"><button type="button" disabled={!lead.id} className="text-left font-bold text-indigo-700 underline decoration-indigo-200 underline-offset-4 hover:text-indigo-900 focus-visible:outline focus-visible:outline-2 disabled:no-underline" onClick={() => onOpenLead(lead.id)}>{lead.company || '업체명 미등록'}</button></td>
          <td className="px-3 py-3 text-slate-600">{lead.channel || '채널 미등록'}</td>
          <td className="px-3 py-3">{customerType}</td><td className="whitespace-nowrap px-3 py-3 tabular-nums">{lead.contractAt || '미등록'}</td>
          <td className="px-3 py-3">{lead.salesOwner || '미배정'}</td><td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums text-teal-700">{money(amount)}</td>
        </tr>)}
        {!sorted.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">이 기간·채널의 계약 완료 기업이 없습니다.</td></tr>}</tbody>
        <tfoot className="bg-slate-100 font-bold"><tr><td colSpan={5} className="px-3 py-3">합계 · {rows.length.toLocaleString()}곳</td><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{money(total)}</td></tr></tfoot>
      </table>
    </div>
  </div>;
}
