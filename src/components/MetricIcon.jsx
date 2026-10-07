import React from 'react';
import { UsersRound, CalendarCheck2, FileCheck2, Wallet, TrendingUp, Megaphone, ClipboardList, Layers3 } from 'lucide-react';

function metricStyle(label) {
  if (/미수/.test(label)) return { Icon: Wallet, tone: 'amber' };
  if (/수금|입금|결제/.test(label)) return { Icon: Wallet, tone: 'teal' };
  if (/계약/.test(label)) return { Icon: FileCheck2, tone: 'blue' };
  if (/견적/.test(label)) return { Icon: ClipboardList, tone: 'slate' };
  if (/미팅/.test(label)) return { Icon: CalendarCheck2, tone: 'indigo' };
  if (/전환|ROAS|MRR/.test(label)) return { Icon: TrendingUp, tone: 'indigo' };
  if (/DB|유입|고객/.test(label)) return { Icon: UsersRound, tone: 'blue' };
  return { Icon: Layers3, tone: 'slate' };
}
export function MetricIcon({ label }) {
  const { Icon, tone } = metricStyle(label);
  return <span className="kpi-block-icon" data-tone={tone} aria-hidden="true"><Icon size={18} strokeWidth={1.7} /></span>;
}
export function StageIcon({ stage }) {
  const Icon = stage === 'marketing' ? Megaphone : stage === 'pre' ? CalendarCheck2 : FileCheck2;
  return <Icon className="kpi-stage-glyph" size={23} strokeWidth={1.7} aria-hidden="true" />;
}
