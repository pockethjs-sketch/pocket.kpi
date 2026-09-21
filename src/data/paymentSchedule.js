export const paymentRows = (lead) => Array.isArray(lead && lead.payments) ? lead.payments : [];

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
