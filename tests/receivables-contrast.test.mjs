import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css=readFileSync(new URL('../src/receivables-table.css',import.meta.url),'utf8');
const rule=selector=>{
  const start=css.indexOf(selector+' {');
  assert.ok(start>=0,`Missing scoped selector: ${selector}`);
  return css.slice(start,css.indexOf('}',start));
};
test('dark selects and options override the app-wide important light-form colors',()=>{
  const select=rule('.receivables-table select.receivables-select');
  assert.match(select,/color:#f1f1ed!important/);
  assert.match(select,/border:1px solid #777772!important/);
  assert.match(select,/min-height:34px/);
  const option=rule('.receivables-table select.receivables-select option');
  assert.match(option,/background-color:#282828!important/);
  assert.match(option,/color:#f1f1ed!important/);
  assert.match(rule('.receivables-table select.receivables-select--paid'),/color:#d6edff!important/);
});
test('dark note editor and shared delete button have scoped contrast overrides',()=>{
  assert.match(rule('.receivables-table textarea.receivables-editor'),/color:var\(--rt-text\)!important/);
  assert.match(rule('.receivables-table .receivables-note-tools button'),/background-color:#292929!important/);
  assert.match(rule('.receivables-table .receivables-note-tools button.text-red-600'),/color:#ffb4b4!important/);
  assert.match(rule('.receivables-table .receivables-note-tools button'),/min-height:32px/);
});
