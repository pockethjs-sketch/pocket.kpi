import test from 'node:test';
import assert from 'node:assert/strict';
import { leadDisplayName } from '../src/data/leadDisplayName.js';

test('prospective founders are distinguished by contact without mutating records', () => {
  const lead = { company: '예비', contact: '테스트가' };
  assert.equal(leadDisplayName(lead), '예비 · 테스트가 대표');
  assert.equal(lead.company, '예비');
  assert.equal(leadDisplayName({ company: '예비창업자', contact: '테스트나' }), '예비창업자 · 테스트나 대표');
  assert.equal(leadDisplayName({ company: '예비', contact: '' }), '예비 · 대표자 미입력');
  assert.equal(leadDisplayName({ company: '예비', contact: '대표님' }), '예비 · 대표자 미입력');
});
test('ordinary company names and missing records are preserved', () => {
  assert.equal(leadDisplayName({ company: '예비솔루션', contact: '테스트' }), '예비솔루션');
  assert.equal(leadDisplayName({ company: '가상기업', contact: '테스트' }), '가상기업');
  assert.equal(leadDisplayName(), '');
});
