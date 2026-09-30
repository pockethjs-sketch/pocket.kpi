// Presentation-only preferences, not API authorization. Identity comes from
// the verified employee session endpoint. Keep raw account identifiers private.
export const EMPLOYEE_MENU_PROFILES = Object.freeze({
  '6bb616ffd70783a6721c1080649251499cf39ae84392b75c69d397d700bc042b': Object.freeze(['deals', 'ltvExpansion']),
});

export async function applyEmployeeMenuPolicy(employee, profiles = EMPLOYEE_MENU_PROFILES) {
  if (!employee?.userId || !employee.organizationId || employee.role !== 'VIEWER') return employee;
  const identity = new TextEncoder().encode(`${employee.organizationId}:${employee.userId}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', identity);
  const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const pages = profiles[fingerprint];
  return pages ? { ...employee, menuPages: [...pages] } : employee;
}
