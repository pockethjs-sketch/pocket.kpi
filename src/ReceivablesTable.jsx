import React from 'react';
import { AlignLeft, CalendarDays, Circle, CircleChevronDown, FileText, List, LoaderCircle, Type } from 'lucide-react';
import './receivables-table.css';

const dateColumn = { key: 'date', label: '계약진행일', width: 130, icon: CalendarDays };
const companyColumn = { key: 'company', label: '업체', width: 176, icon: Type };
const owners = [
  { key: 'pre', label: '프리', width: 90, icon: CircleChevronDown },
  { key: 'guide', label: '가이드', width: 90, icon: CircleChevronDown },
];
const endColumns = [
  { key: 'project', label: '프로젝트', width: 112, icon: List },
  { key: 'notes', label: '특이사항', width: 320, icon: AlignLeft },
  { key: 'status', label: '상태', width: 128, icon: LoaderCircle },
  { key: 'payment', label: '입금', width: 112, icon: LoaderCircle },
];
export const NOTION_RECEIVABLE_COLUMNS = [dateColumn, companyColumn, ...owners,
  { key: 'deposit', label: '선금 금액', width: 186, icon: AlignLeft },
  { key: 'balance', label: '잔금금액', width: 186, icon: AlignLeft }, ...endColumns];
export const LEDGER_RECEIVABLE_COLUMNS = [dateColumn, companyColumn, ...owners,
  { key: 'deposit', label: '선금 금액', width: 186, icon: AlignLeft },
  { key: 'middle', label: '중도금', width: 186, icon: AlignLeft },
  { key: 'balance', label: '잔금금액', width: 186, icon: AlignLeft }, ...endColumns];

// Decorative tag colors only; payment/request classification remains in domain helpers.
export function ReceivableTag({ children, kind = 'person' }) {
  const text = String(children ?? '').trim();
  if (!text || text === '-' || text === '—' || text === '미배정') return <span className="receivables-muted">{text || '—'}</span>;
  const palette = ['brown', 'purple', 'gold', 'blue', 'green'];
  const hash = Array.from(text).reduce((sum, char) => sum + char.codePointAt(0), 0);
  return <span className={'receivables-tag receivables-tag--' + (kind === 'project' ? (/투자/.test(text) ? 'gold' : /브랜딩/.test(text) ? 'purple' : /홈페이지/.test(text) ? 'red' : 'blue') : palette[hash % palette.length])}>{text}</span>;
}

export function ReceivableStatus({ value, payment = false }) {
  const text = String(value ?? '').trim();
  if (!text) return <span className="receivables-muted">—</span>;
  const paid = payment && (text === '입금완료' || text === '카결완료');
  return <span className={'receivables-status' + (paid ? ' receivables-status--paid' : '')}><Circle size={8} fill="currentColor" aria-hidden="true" />{text}</span>;
}

export function ReceivableCompany({ children, href, onClick }) {
  const content = <><FileText size={16} aria-hidden="true" /><span>{children || '업체명 미입력'}</span></>;
  if (onClick) return <button type="button" className="receivables-company" onClick={onClick}>{content}</button>;
  if (href) return <a className="receivables-company" href={href} target="_blank" rel="noopener noreferrer" title="노션 원본 열기">{content}</a>;
  return <span className="receivables-company">{content}</span>;
}

export default function ReceivablesTable({ columns, label, children, empty = false }) {
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  return <div className="receivables-table-shell">
    <div className="receivables-table-scroll" role="region" aria-label={label + ' · 가로 스크롤'} tabIndex={0}>
      <table className="receivables-table" style={{ minWidth: width }}>
        <caption className="sr-only">{label}</caption>
        <colgroup>{columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}</colgroup>
        <thead><tr>{columns.map(({ key, label: title, icon: Icon }) => <th key={key} scope="col"><span className="receivables-column-title"><Icon size={14} aria-hidden="true" />{title}</span></th>)}</tr></thead>
        <tbody>{empty ? <tr><td colSpan={columns.length} className="receivables-empty">조건에 맞는 자료가 없습니다.</td></tr> : children}</tbody>
      </table>
    </div>
  </div>;
}
