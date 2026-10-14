// Presentation only: never replace the stored company name or matching keys.
export function leadDisplayName(lead = {}) {
  const company = String(lead.company || '').trim();
  if (!/^(예비|예비\s*창업자)$/.test(company)) return company;
  const contact = String(lead.contact || '').trim();
  return contact && !['-', '미정', '대표님'].includes(contact)
    ? `${company} · ${contact} 대표`
    : `${company} · 대표자 미입력`;
}
