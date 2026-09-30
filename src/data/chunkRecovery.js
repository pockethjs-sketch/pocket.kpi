const RECOVERY_KEY = 'pocket-kpi:chunk-recovery:v1';
const RETRY_WINDOW = 10 * 60 * 1000;

export function isChunkLoadError(error) {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk .+ failed/i.test(String(error?.message || error));
}

export function freshEntryUrl(href, now = Date.now()) {
  const url = new URL(href);
  url.searchParams.set('_kpi_reload', String(now));
  return url.href;
}

// Only called before the app mounts. Never erase auth or unsaved business journals.
export function recoverChunkLoad(error, { storage, location, online = true, now = Date.now() }) {
  if (!online || !isChunkLoadError(error)) return false;
  try {
    const previous = Number(storage.getItem(RECOVERY_KEY));
    if (previous > 0 && now - previous < RETRY_WINDOW) return false;
    storage.setItem(RECOVERY_KEY, String(now));
  } catch {
    // Without a persistent guard, a reload could loop. Leave the manual button instead.
    return false;
  }
  location.replace(freshEntryUrl(location.href, now));
  return true;
}
