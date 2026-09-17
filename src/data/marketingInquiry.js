// Ads report conversions and CRM arrivals are distinct facts. Keep both in the daily view.
export function reconcileMarketingDailyInquiries(rows, leads, provider, channelGroup, schema) {
  const crmByDate = new Map();
  for (const lead of leads || []) {
    const date = String(lead.createdAt || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || channelGroup(lead.channel) !== provider) continue;
    crmByDate.set(date, (crmByDate.get(date) || 0) + 1);
  }
  return (rows || []).map((row) => ({
    ...row,
    crm: crmByDate.get(String(row.date || '')) || 0,
    media: Number(schema === 'supabase-marketing-v2' ? row.crm : row.media) || 0,
  }));
}
