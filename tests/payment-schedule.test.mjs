import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentScheduleSum, paymentTotalAmount, syncPaymentScheduleTotal } from '../src/data/paymentSchedule.js';

test('회차가 있으면 별도 총액보다 회차 합계를 우선한다', () => {
  const lead = {
    status: '프리미팅 확정', expected: 0, contractAmount: 0,
    payments: [{ amount: 6_000_000 }, { amount: 8_000_000 }, { amount: 6_000_000 }],
  };
  assert.equal(paymentScheduleSum(lead), 20_000_000);
  assert.equal(paymentTotalAmount(lead), 20_000_000);
});

test('초기 단계 회차 합계는 expected에 보존된다', () => {
  const lead = { status: '프리미팅 확정', expected: 0, contractAmount: 0, payments: [{ amount: 20_000_000 }] };
  syncPaymentScheduleTotal(lead);
  assert.equal(lead.expected, 20_000_000);
  assert.equal(lead.contractAmount, 0);
});

test('계약 완료 회차 합계는 contractAmount에 보존된다', () => {
  const lead = { status: '계약 완료', expected: 18_000_000, contractAmount: 18_000_000, payments: [{ amount: 6_000_000 }, { amount: 14_000_000 }] };
  syncPaymentScheduleTotal(lead);
  assert.equal(lead.contractAmount, 20_000_000);
  assert.equal(paymentTotalAmount(lead), 20_000_000);
});

test('회차가 없으면 기존 총액 입력을 유지한다', () => {
  const lead = { status: '프리미팅 확정', expected: 12_000_000, contractAmount: 0, payments: [] };
  syncPaymentScheduleTotal(lead);
  assert.equal(paymentTotalAmount(lead), 12_000_000);
  assert.equal(lead.expected, 12_000_000);
});
