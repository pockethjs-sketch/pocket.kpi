export const MASTER_LOGIN_ALIAS = 'MASTER';

export function isMasterLoginAlias(value) {
  return String(value || '').trim().toUpperCase() === MASTER_LOGIN_ALIAS;
}

export function resolveEmployeeLoginEmail(loginId, linkedMasterEmail = '') {
  const candidate = isMasterLoginAlias(loginId) ? linkedMasterEmail : loginId;
  return String(candidate || '').trim().toLowerCase();
}

export function isPlausibleEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}
