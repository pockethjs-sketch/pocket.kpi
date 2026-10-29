export const paymentRows = (lead) => Array.isArray(lead && lead.payments) ? lead.payments : [];

// Explicit edits only. A completion toggle must never erase a received date.
export function setPaymentPaidDate(payment, date) {
  if (!payment || typeof date !== 'string' || (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date))) throw Error('invalid_payment_date');
  if (!date && payment.paidAt) throw Error('dated_payment_requires_explicit_cancellation');
  payment.paidAt = date;
  if (date) { payment.paidConfirmed = true; delete payment.actualPaidAtUnknown; }
  return payment;
}

export function setPaymentConfirmed(payment, confirmed) {
  if (!payment || typeof confirmed !== 'boolean') throw Error('invalid_payment_confirmation');
  if (!confirmed && payment.paidAt) throw Error('dated_payment_requires_explicit_cancellation');
  payment.paidConfirmed = confirmed;
  if (confirmed && !payment.paidAt) payment.actualPaidAtUnknown = true;
  return payment;
}

export const paymentScheduleSum = (lead) => paymentRows(lead)
  .reduce((sum, payment) => sum + (Number(payment && payment.amount) || 0), 0);

export const paymentTotalAmount = (lead) => {
  const scheduleTotal = paymentScheduleSum(lead);
  if (scheduleTotal > 0) return scheduleTotal;
  return Number(lead && lead.contractAmount) || Number(lead && lead.expected) || 0;
};

export const syncPaymentScheduleTotal = (lead) => {
  const scheduleTotal = paymentScheduleSum(lead);
  if (!(scheduleTotal > 0) || !lead) return lead;
  if (lead.status === "계약 완료") lead.contractAmount = scheduleTotal;
  else lead.expected = scheduleTotal;
  return lead;
};
