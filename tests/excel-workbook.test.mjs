import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { excelTable } from '../src/data/excelTable.js';
import { buildExcelWorkbook, worksheetXml, uniqueSheetNames, safeExcelFilename, columnName } from '../src/data/excelWorkbook.js';

// Independent ZIP header reader; the browser test also reopens the file with openpyxl.
export function unzipStored(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), files = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    assert.equal(view.getUint16(at + 8, true), 0);
    const length = view.getUint32(at + 18, true), nameLength = view.getUint16(at + 26, true), extra = view.getUint16(at + 28, true);
    const start = at + 30 + nameLength + extra;
    const name = new TextDecoder().decode(bytes.slice(at + 30, at + 30 + nameLength));
    files[name] = new TextDecoder().decode(bytes.slice(start, start + length));
    at = start + length;
  }
  assert.equal(view.getUint32(at, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  return files;
}
test('real XLSX ZIP contains workbook, relationships, typed raw numeric data and blanks', () => {
  const files = unzipStored(buildExcelWorkbook([excelTable('테스트', ['업체', '금액', '미상', '입금', '날짜', '전화'], [['가상 기업', 3610123, null, true, '2026-10-02', '01001234567']])], '선택 기간'));
  assert.equal(Object.keys(files).length, 6);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /r="B6" s="2"><v>3610123<\/v>/);
  assert.match(sheet, /r="C6" s="0"\/>/);
  assert.match(sheet, /r="D6" t="b"/);
  assert.match(sheet, /r="E6" s="3"><v>\d+<\/v>/);
  assert.match(sheet, /01001234567/);
  assert.match(sheet, /state="frozen"/);
  assert.match(sheet, /autoFilter ref="A5:F6"/);
});
test('formula-looking strings are never executable; XML control characters escaped', () => {
  const result = worksheetXml(excelTable('테스트', ['메모'], [['=HYPERLINK("https://evil.invalid","x")'], ['+1+1'], ['@SUM(1)'], ['<tag> & "quote"\u0001']]));
  assert.doesNotMatch(result, /<f[ >]|<hyperlink|\u0001|<tag>/);
  assert.match(result, /&lt;tag&gt; &amp; &quot;quote&quot;/);
  assert.match(result, /t="inlineStr"/);
});
test('sheet names are valid, distinct and bounded; columns beyond Z work', () => {
  const names = uniqueSheetNames([{ name: 'a/b' }, { name: 'a:b' }, { name: 'a_b' }, { name: 'a'.repeat(40) }]);
  assert.equal(new Set(names).size, 4);
  assert.ok(names.every(n => n.length <= 31 && !/[/?*\[\]:\\]/.test(n)));
  assert.equal(columnName(26), 'AA');
  assert.match(safeExcelFilename('a/b:c'), /a_b_c/);
});
test('zero rows retain headers, multi-sheet files remain separate and unsupported values fail explicitly', () => {
  const empty = excelTable('빈 목록', ['업체'], []);
  const files = unzipStored(buildExcelWorkbook([empty, empty]));
  assert.ok(files['xl/worksheets/sheet2.xml']);
  assert.match(files['xl/worksheets/sheet1.xml'], /A5:A5/);
  assert.throws(() => worksheetXml(excelTable('x', ['x'], [[{}]])), /변환되지/);
  assert.throws(() => worksheetXml(excelTable('x', ['x'], [['x'.repeat(32768)]])), /제한/);
  assert.throws(() => worksheetXml(excelTable('x', ['x'], [[1, 2]])), /개수/);
});
test('exports never read server credentials or serialize whole DB; download is browser-local', () => {
  const writer = readFileSync(new URL('../src/data/excelWorkbook.js', import.meta.url), 'utf8');
  assert.doesNotMatch(writer, /fetch\(|localStorage|sessionStorage|JSON.stringify|authorization|access_token/);
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /allowed=\{canAccess\(effectiveView\)/);
  assert.match(main, /exportLeadTable\('프리미팅 기업', pool/);
  assert.match(main, /sourceTab === 'ledger' && ledgerTab !== 'add'/);
});
