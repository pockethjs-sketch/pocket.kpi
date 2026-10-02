// Browser-only, dependency-free XLSX snapshot writer. No formulas, macros, links or network.
const encode = value => new TextEncoder().encode(value);
const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export function columnName(index) {
  let name = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
export function safeExcelFilename(title, stamp = new Date()) {
  return `포켓KPI_${String(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 90)}_${stamp.toISOString().replace(/[-:]/g, '').slice(0, 15)}.xlsx`;
}
export function uniqueSheetNames(tables) {
  const used = new Set();
  return tables.map((table, i) => {
    const base = String(table.name || `목록${i + 1}`).replace(/[\\/?*\[\]:\u0000-\u001f]/g, '_').replace(/^'+|'+$/g, '').slice(0, 31) || `목록${i + 1}`;
    let name = base, suffix = 1;
    while (used.has(name.toLowerCase())) { const end = ` (${++suffix})`; name = base.slice(0, 31 - end.length) + end; }
    used.add(name.toLowerCase()); return name;
  });
}
function cell(value, index, row, style) {
  const ref = `${columnName(index)}${row}`;
  if (value == null || value === '') return `<c r="${ref}" s="${style || 0}"/>`;
  if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}" s="${style || 2}"><v>${value}</v></c>` : `<c r="${ref}"/>`;
  if (typeof value === 'boolean') return `<c r="${ref}" t="b" s="${style || 0}"><v>${value ? 1 : 0}</v></c>`;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('유효하지 않은 날짜가 있습니다.');
    return `<c r="${ref}" s="3"><v>${value.getTime() / 86400000 + 25569}</v></c>`;
  }
  if (typeof value !== 'string') throw new Error('엑셀 열에 변환되지 않은 데이터가 있습니다.');
  // Dates are numeric; identifiers (including leading zeroes) stay literal text.
  if (!style && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value) return cell(new Date(value), index, row);
  if (value.length > 32767) throw new Error('한 셀의 내용이 엑셀 제한(32,767자)을 넘습니다. 범위를 줄여주세요.');
  return `<c r="${ref}" s="${style || 0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}
export function worksheetXml(table, context = '') {
  if (!table.headers?.length || table.headers.length > 16384) throw new Error('내보낼 열을 확인하세요.');
  if (table.rows.length > 100000) throw new Error('한 시트에 10만 행까지 내려받을 수 있습니다. 기간을 줄여주세요.');
  const records = [[table.name], [[context, table.scope].filter(Boolean).join(' · ')], [], [], table.headers, ...table.rows];
  if (table.rows.some(row => row.length !== table.headers.length)) throw new Error('엑셀 열과 데이터 개수가 일치하지 않습니다.');
  const last = `${columnName(table.headers.length - 1)}${records.length}`;
  const cols = table.headers.map((label, i) => `<col min="${i + 1}" max="${i + 1}" width="${/내용|메모|특이|설명/.test(label) ? 55 : /업체|상품|프로젝트|빌드업/.test(label) ? 28 : 20}" customWidth="1"/>`).join('');
  const data = records.map((row, i) => `<row r="${i + 1}"${i === 4 ? ' ht="28" customHeight="1"' : ''}>${row.map((value, j) => cell(value, j, i + 1, i === 4 ? 1 : i === 0 ? 4 : 0)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${cols}</cols><sheetData>${data}</sheetData><autoFilter ref="A5:${last}"/></worksheet>`;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => { let c = i; for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipStore(files) {
  const parts = [], central = []; let offset = 0, centralSize = 0;
  for (const [path, content] of files) {
    const name = encode(path), bytes = encode(content), crc = crc32(bytes);
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(12, 33, true);
    h.setUint32(14, crc, true); h.setUint32(18, bytes.length, true); h.setUint32(22, bytes.length, true); h.setUint16(26, name.length, true); header.set(name, 30);
    const directory = new Uint8Array(46 + name.length), d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(14, 33, true);
    d.setUint32(16, crc, true); d.setUint32(20, bytes.length, true); d.setUint32(24, bytes.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46);
    parts.push(header, bytes); central.push(directory); offset += header.length + bytes.length; centralSize += directory.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length); let position = 0;
  for (const part of [...parts, ...central, end]) { out.set(part, position); position += part.length; } return out;
}
export function buildExcelWorkbook(tables, context = '') {
  if (!tables?.length) throw new Error('현재 화면에 내보낼 데이터가 없습니다.');
  const names = uniqueSheetNames(tables);
  const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const type = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tables.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${type}officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="${rel}">${tables.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${type}worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="styles" Type="${type}styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0"?><styleSheet xmlns="${ns}"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="#,##0.########"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...tables.map((table, i) => [`xl/worksheets/sheet${i + 1}.xml`, worksheetXml(table, context)]),
  ];
  return zipStore(files);
}
export function downloadExcelWorkbook(tables, title, context) {
  const bytes = buildExcelWorkbook(tables, context);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = safeExcelFilename(title); document.body.append(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
