import { contractAmount } from './contractBasis.js';

export const SALES_BUILDUPS = ['지원사업 관리', '투자유치', '브랜딩 관리', 'AX 개발', '포켓비즈'];
const normalize = value => String(value || '').trim().replace(/\s+/g, '').toLowerCase();
const list = value => Array.isArray(value) ? value : [];
const active = lead => lead && !lead.archived_at && !lead.archivedAt && !lead.deletedAt;
const dateKey = value => {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(raw)) return '';
  const day = raw.slice(0, 10);
  const parsed = new Date(day + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return '';
  if (raw.length === 10) return day;
  const time = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : raw.replace(' ', 'T') + '+09:00');
  return Number.isNaN(time.getTime()) ? '' : new Date(time.getTime() + 9 * 3600000).toISOString().slice(0, 10);
};

// Use explicit saved selections, not company names, notes, price guesses or payment counts.
export function salesBuildups(lead, products = []) {
  const names = [...new Set([...SALES_BUILDUPS, ...products.map(p => p.name).filter(Boolean)])];
  const resolve = value => {
    const raw = normalize(value);
    if (!raw) return '';
    const exact = names.find(name => normalize(name) === raw);
    if (exact) return exact;
    const matches = products.filter(p => list(p.items).some(item => normalize(item.name) === raw));
    const parents = [...new Set(matches.map(p => p.name).filter(Boolean))];
    if (parents.length === 1) return parents[0];
    // Explicit legacy labels only; unrecognized labels remain visible as unclassified.
    if (/^(지원사업(?:관리)?|정부지원|정책자금)(?:[abc]|\(v\d+\))?$/i.test(raw)) return '지원사업 관리';
    if (/^(투자유치|자금유치)(?:[abc]|\(v\d+\))?$/i.test(raw)) return '투자유치';
    if (/^(브랜딩(?:관리)?|홈페이지|유튜브|인스타|메타)(?:\(v\d+\))?$/i.test(raw)) return '브랜딩 관리';
    if (/^(ax개발|개발|mvp)(?:\(v\d+\))?$/i.test(raw)) return 'AX 개발';
    return '';
  };
  const raw = [lead.buildup, ...list(lead.buildups), ...list(lead.lineItems).map(item => item?.buildup || item?.name)].filter(Boolean);
  const groups = [...new Set(raw.map(resolve).filter(Boolean))];
  return { groups: groups.length ? groups : ['미분류'], raw: [...new Set(raw.map(String))], unmapped: [...new Set(raw.filter(v => !resolve(v)).map(String))] };
}

export function summarizeProductSales(leads = [], products = [], range = null, customerType = '전체') {
  const rows = [], undated = [], missingAmount = [];
  const seen = new Set();
  for (const lead of leads) {
    if (!active(lead) || !lead.id || seen.has(String(lead.id))) continue;
    seen.add(String(lead.id));
    if (lead.status !== '계약 완료') continue;
    const type = lead.ctype || '신규';
    if (customerType !== '전체' && type !== customerType) continue;
    const date = dateKey(lead.contractAt);
    const amount = contractAmount(lead);
    const row = { lead, date, amount, type, ...salesBuildups(lead, products) };
    if (!date) { undated.push(row); continue; }
    if (range && (date < range[0] || date > range[1])) continue;
    if (!Number.isFinite(amount) || amount <= 0) { missingAmount.push(row); continue; }
    rows.push(row);
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || String(a.lead.id).localeCompare(String(b.lead.id)));
  const names = [...new Set([...SALES_BUILDUPS, ...products.map(p => p.name).filter(Boolean), ...rows.flatMap(row => row.groups)])];
  const groups = names.map(name => {
    const contracts = rows.filter(row => row.groups.includes(name));
    return { name, rows: contracts, count: contracts.length, newCount: contracts.filter(row => row.type === '신규').length, existingCount: contracts.filter(row => row.type === '기존').length, otherCount: contracts.filter(row => !['신규','기존'].includes(row.type)).length };
  }).sort((a, b) => b.count - a.count);
  return { rows, groups, undated, missingAmount, total: rows.length, amount: rows.reduce((sum, row) => sum + row.amount, 0), multiple: rows.filter(row => row.groups.length > 1).length, unclassified: rows.filter(row => row.groups.includes('미분류')).length };
}
