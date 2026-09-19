export const MASTER_LOGIN_ALIAS = 'MASTER';

export function isMasterLoginAlias(value) {
  return String(value || '').trim().toUpperCase() === MASTER_LOGIN_ALIAS;
}

export function isPlausibleEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export function consumeMasterSetupToken(locationLike, historyLike, storage) {
  const url = new URL(locationLike.href);
  const incoming = url.searchParams.get('master_setup') || '';
  if (incoming) {
    storage.setItem('pocket-kpi:master-setup-token:v1', incoming);
    url.searchParams.delete('master_setup');
    historyLike.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }
  return incoming || storage.getItem('pocket-kpi:master-setup-token:v1') || '';
}
