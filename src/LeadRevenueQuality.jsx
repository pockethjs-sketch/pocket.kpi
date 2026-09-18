import React from "react";
import { REVENUE_GROUPS, summarizeRevenueQuality } from "./data/leadRevenueQuality.js";

export default function LeadRevenueQuality({ leads, label, dayLeads = [], dayLabel }) {
  const total = summarizeRevenueQuality(leads);
  const day = summarizeRevenueQuality(dayLeads);
  return <section className="mt-4 border-t border-slate-200 pt-4" aria-label="유입 DB 매출 단계">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-extrabold text-slate-800">유입 DB 매출 단계</h3>
      <p className="text-[11px] text-slate-500">{label} · 주말 포함 {total.total}건</p>
    </div>
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {REVENUE_GROUPS.map(({ key, label: title }) => <div key={key} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
        <p className="min-h-8 text-[11px] font-bold text-slate-600">{title}</p>
        <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{total[key]}<span className="ml-1 text-xs font-medium text-slate-500">건</span></p>
        {dayLabel && <p className="mt-2 text-[11px] text-sky-700">{dayLabel} · {day[key]}건</p>}
      </div>)}
    </div>
    <p className="mt-2 text-[11px] text-slate-500">매출 미입력 {total.missing}건 · 분류 확인 필요 {total.uncertain}건{dayLabel && ` / ${dayLabel}: 미입력 ${day.missing}건 · 확인 필요 ${day.uncertain}건`}</p>
    <p className="mt-1 text-[10px] leading-5 text-slate-400">CRM 매출 응답 기준이며 TM 상·중·하 점수와 별개입니다. 10억 이상으로 명시된 응답은 1억 이상에 중복 집계하지 않습니다. ‘3억 이상’은 응답의 하한값 기준으로 1억 이상에 포함하며, ‘5~20억’·‘5억 미만’·금액 없는 매출 발생은 확인 필요로 남깁니다. 월매출을 연환산하거나 빈 값을 매출없음으로 바꾸지 않습니다.</p>
    {total.unresolved.length > 0 && <details className="mt-2 text-[11px] text-slate-500"><summary className="cursor-pointer">분류 확인이 필요한 원본 응답</summary><ul className="mt-2 space-y-1">{total.unresolved.map(({ label: answer, count }) => <li key={answer}>{answer} · {count}건</li>)}</ul></details>}
  </section>;
}
