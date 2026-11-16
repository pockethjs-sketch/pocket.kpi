export function premeetingWindow(start, end, today, internalService, repair = false) {
  const recentStart = new Date(Date.parse(today + 'T00:00:00Z') - 2 * 86400000).toISOString().slice(0, 10);
  const project = start === recentStart && end === today && (!internalService || repair === true);
  const last = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return { project, start: project ? today.slice(0, 7) + '-01' : start, end: project ? last : end };
}

// Read every page, never declare a capped/repeated response complete.
export async function collectPremeetingPages(url, headers, fetcher, decodeRows) {
  const records = new Map();
  for (let offset = 0; offset < 50000; offset += 500) {
    const pageUrl = new URL(url); pageUrl.searchParams.set('offset', String(offset)); pageUrl.searchParams.set('limit', '500');
    const response = await fetcher(pageUrl.toString(), { headers });
    if (!response.ok) throw new Error(`calendar_http_${response.status}`);
    const page = decodeRows(await response.json());
    if (!page.length) return [...records.values()];
    let added = 0;
    for (const record of page) {
      const id = String(record?.ms_no ?? '');
      if (!id) throw new Error('calendar_identity_invalid');
      if (records.has(id)) {
        if (JSON.stringify(records.get(id)) !== JSON.stringify(record)) throw new Error('calendar_page_changed');
      } else { records.set(id, record); added++; }
    }
    if (!added) throw new Error('calendar_page_repeated');
  }
  throw new Error('calendar_page_limit');
}
