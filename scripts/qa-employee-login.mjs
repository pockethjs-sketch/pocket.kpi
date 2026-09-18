import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KPI_QA_PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const requests = [], errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('pocketcrm:db:v4', JSON.stringify({ leads: [{ company: 'UNAUTHENTICATED_CACHE_SENTINEL' }] }));
    localStorage.setItem('crm:pendingMutations:v1', '[{"syntheticPreserved":true}]');
  });
  await page.goto('https://pockethjs-sketch.github.io/pocket.kpi/', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '포켓 KPI · 직원 로그인' }).waitFor();
  assert.equal(await page.locator('input[type=email]').count(), 1);
  assert.equal(await page.locator('input[type=password]').count(), 1);
  assert.equal(await page.getByText('UNAUTHENTICATED_CACHE_SENTINEL').count(), 0);
  assert.equal(requests.filter((url) => /\/assets\/main-[^/]+\.js/.test(url)).length, 0);
  assert.equal(requests.filter((url) => /functions\/v1|script\.google\.com|\/rest\/v1/.test(url)).length, 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('crm:pendingMutations:v1')), '[{"syntheticPreserved":true}]');
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log(JSON.stringify({ loginVisible: true, customerCacheHidden: true, crmCodeNotImported: true, businessRequestsBeforeLogin: 0, legacyJournalPreserved: true, pageErrors: 0, mobileNoOverflow: true }));
} finally { await browser.close(); }
