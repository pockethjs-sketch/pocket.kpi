// Read-only diagnostic/backfill input. Output consists only of dated counts and hashes.
// Credential paths are supplied at runtime; never print credentials or source payloads.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { collectWebsiteInquiries, inquiryDates } from '../supabase/functions/_shared/website-inquiries.mjs';
const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? '' : process.argv[index + 1] || ''; };
const start = arg('--start'), end = arg('--end');
const hash = value => createHash('sha256').update(value).digest('hex');
async function main() {
  const crm = readFileSync(arg('--crm-credential-file'), 'utf8').trim();
  const meta = readFileSync(arg('--meta-credential-file'), 'utf8').trim();
  const headers = { authorization: 'Bearer ' + crm, origin: 'https://crm.xn--9i1b674cwc38r6pa.com', referer: 'https://crm.xn--9i1b674cwc38r6pa.com/', 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' };
  const website = await collectWebsiteInquiries({ headers, start, end, hash: value => hash(JSON.stringify(value)) });
  const account = arg('--meta-account');
  if (!/^\d+$/.test(account)) throw Error('inquiry_meta_account_invalid');
  async function metaGet(raw) {
    const url = new URL(raw);
    if (url.origin !== 'https://graph.facebook.com') throw Error('inquiry_meta_origin_invalid');
    url.searchParams.delete('access_token');
    const response = await fetch(url, { headers: { authorization: 'Bearer ' + meta }, signal: AbortSignal.timeout(30000), redirect: 'error' });
    const body = await response.json();
    if (!response.ok) throw Error('inquiry_meta_http_' + response.status + '_' + (Number(body.error?.code) || 0));
    return body;
  }
  const timezone = await metaGet('https://graph.facebook.com/v25.0/act_' + account + '?fields=timezone_name');
  if (timezone.timezone_name !== 'Asia/Seoul') throw Error('inquiry_meta_timezone_unverified');
  const daily = new Map(inquiryDates(start, end).map(date => [date, { date, count: 0, channels: { META: 0, NAVER: 0, GOOGLE: 0, OTHER: 0 } }]));
  const first = new URL('https://graph.facebook.com/v25.0/act_' + account + '/insights');
  for (const [key,value] of Object.entries({ fields: 'date_start,actions', level: 'account', time_increment: '1', time_range: JSON.stringify({ since: start, until: end }), limit: '500' })) first.searchParams.set(key, value);
  let next = first.toString(); const seen = new Set();
  for (let page=0;next && page<100;page++) {
    const body = await metaGet(next);
    if (!Array.isArray(body.data)) throw Error('inquiry_meta_response_invalid');
    for (const row of body.data) {
      if (!daily.has(row.date_start) || seen.has(row.date_start)) throw Error('inquiry_meta_date_mismatch');
      seen.add(row.date_start);
      const count = Number((row.actions || []).find(action => action.action_type === 'onsite_conversion.lead_grouped')?.value || 0);
      if (!Number.isSafeInteger(count) || count < 0) throw Error('inquiry_meta_metric_invalid');
      daily.get(row.date_start).count = count; daily.get(row.date_start).channels.META = count;
    }
    next = body.paging?.next || '';
    if (page === 99 && next) throw Error('inquiry_meta_page_limit');
  }
  const days = [...daily.values()];
  const metaReport = { schemaVersion: 1, verified: true, source: 'META', basis: 'onsite_conversion.lead_grouped', start, end, daily: days,
    total: days.reduce((sum, day) => sum + day.count, 0), sourceHash: hash(JSON.stringify(days)), completedAt: new Date().toISOString() };
  process.stdout.write(JSON.stringify({ readOnly: true, businessWrites: 0, reports: [website, metaReport] }) + '\n');
}
main().catch(error => { process.stdout.write(JSON.stringify({ ok: false, error: /^inquiry_[a-z0-9_]+$/.test(error.message) ? error.message : 'inquiry_source_read_failed' }) + '\n'); process.exitCode=1; });
