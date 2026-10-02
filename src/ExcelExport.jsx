import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
const ExportContext = createContext(null);
export function ExcelExportProvider({ children }) {
  const registry = useMemo(() => new Map(), []);
  return <ExportContext.Provider value={registry}>{children}</ExportContext.Provider>;
}
// Register only explicit, user-facing columns from the current component's filtered data.
// A missing provider is intentional in isolated component tests/previews.
export function useExcelExport(factory, enabled = true) {
  const registry = useContext(ExportContext), id = useRef(Symbol('excel'));
  useLayoutEffect(() => {
    if (!registry || !enabled) return;
    registry.set(id.current, factory);
    return () => registry.delete(id.current);
  });
}
export function ExcelExportButton({ title, periodLabel, allowed, toast }) {
  const registry = useContext(ExportContext), [busy, setBusy] = useState(false);
  const working = useRef(false);
  if (!allowed) return null;
  const download = async () => {
    if (working.current) return;
    working.current = true; setBusy(true);
    try {
      // Snapshot before async import: changing tabs must never mix export scopes.
      const tables = [...registry.values()].flatMap(factory => factory() || []);
      if (!tables.length) { toast('데이터 조회 후 다운로드해주세요. 지원사업은 리스트 보기, 잔금은 원장·로그에서 가능합니다.'); return; }
      const { downloadExcelWorkbook } = await import('./data/excelWorkbook.js');
      const at = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      downloadExcelWorkbook(tables, `${title}_${periodLabel}`, `${periodLabel} · 내보낸 시각 ${at} KST · 현재 화면 필터 기준`);
      toast(`엑셀 다운로드 · ${tables.length}개 시트`);
    } catch (error) { toast(`엑셀 다운로드 실패 · ${error.message}`); }
    finally { working.current = false; setBusy(false); }
  };
  return <button type="button" disabled={busy} onClick={download} title="현재 화면의 필터 적용 데이터 전체를 엑셀로 다운로드" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"><Download size={14}/>{busy ? '엑셀 생성 중…' : '엑셀 다운로드'}</button>;
}
