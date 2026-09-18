import React from "react";

export default function DailyActivityChart({ days, stage, label, selectedDate, onSelect }) {
  if (!days.length) return <p className="py-8 text-center text-xs text-slate-400">표시할 평일이 없습니다.</p>;
  const width = Math.max(640, days.length * 44 + 56);
  const bottom = 180;
  const series = stage === "pre"
    ? [{ key: "completed", color: "#6366f1" }, { key: "unconfirmed", color: "#94a3b8", dashed: true }]
    : [{ key: "count", color: stage === "contract" ? "#10b981" : "#0ea5e9" }];
  const peak = Math.max(1, ...days.flatMap(day => series.map(item => day[item.key])));
  const x = index => days.length === 1 ? width / 2 : 40 + index * (width - 64) / (days.length - 1);
  const y = value => bottom - value / peak * 140;
  return <div className="mt-4 overflow-x-auto pb-1" aria-label={label + " 평일 선 그래프"}>
    <svg viewBox={`0 0 ${width} 222`} className="block w-full" style={{ minWidth: width }} role="group" aria-label={label + " 날짜별 건수 · 토·일 제외"}>
      <title>{label} · 날짜별 건수 · 토·일 제외</title>
      {[...new Set([0, Math.ceil(peak / 2), peak])].map(value => <g key={value} aria-hidden="true">
        <line x1="32" x2={width - 12} y1={y(value)} y2={y(value)} stroke="#e2e8f0" strokeDasharray="4 4" />
        <text x="25" y={y(value) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{value}</text>
      </g>)}
      {series.map(item => <polyline key={item.key} points={days.map((day, index) => `${x(index)},${y(day[item.key])}`).join(" ")} fill="none" stroke={item.color} strokeWidth="2.5" strokeDasharray={item.dashed ? "5 4" : undefined} strokeLinejoin="round" aria-hidden="true" />)}
      {days.map((day, index) => {
        const selected = selectedDate === day.date;
        const description = day.date + " · " + (stage === "pre" ? `방문 완료 ${day.completed}건 / 방문 미확인 ${day.unconfirmed}건` : `${day.count}건`);
        return <g key={day.date} role="button" tabIndex={0} aria-label={description} aria-pressed={selected}
          onClick={() => onSelect(day.date)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(day.date); } }}
          className="group cursor-pointer outline-none">
          <title>{description}</title>
          <rect x={x(index) - 19} y="12" width="38" height="206" rx="4" fill={selected ? "#eef2ff" : "transparent"} fillOpacity={selected ? 0.6 : 1} className="group-hover:stroke-indigo-200 group-focus:stroke-indigo-500" />
          {series.map(item => <circle key={item.key} cx={x(index)} cy={y(day[item.key])} r={selected ? 5 : 4} fill="white" stroke={item.color} strokeWidth="2.5" />)}
          <text x={x(index)} y={y(day[series[0].key]) - 11} textAnchor="middle" fontSize="10" fontWeight="700" fill={series[0].color}>{day[series[0].key]}</text>
          <text x={x(index)} y="205" textAnchor="middle" fontSize="10" fill={selected ? "#4338ca" : "#64748b"} fontWeight={selected ? "700" : "400"}>{Number(day.date.slice(8))}일</text>
        </g>;
      })}
    </svg>
  </div>;
}
