import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

test("manual premeeting refresh uses the shared recent-three-day server action", () => {
  assert.match(source, /crmPostSheetAction\('premeeting_sync', \{\}, 90000\)/);
  const body=source.slice(source.indexOf('const refreshTodayPremeetings ='),source.indexOf('const addDeal ='));
  assert.match(body,/crmSyncRecentPremeetings/);
  assert.match(body,/crmReloadAfterContractSync/);
  assert.doesNotMatch(body,/rangeStart = r/);
  assert.match(source, /Number\(meeting\.mr_type\) === 1/);
});

test("calendar meetings are retained by ms_no instead of replacing one field", () => {
  assert.match(source, /lead\.crmMeetings\.findIndex/);
  assert.match(source, /String\(item && item\.msNo\) === String\(meeting\.ms_no\)/);
  assert.match(source, /lead\.crmMeeting = lead\.crmMeetings\[lead\.crmMeetings\.length - 1\]/);
});

test("contract month filtering considers every stored CRM meeting date", () => {
  assert.match(source, /const crmMeetingDates = \(lead\)/);
  assert.match(source, /const premeetingCompanyDateInRange = \(lead, range\)/);
  assert.match(source, /crmMeetingDates\(lead\)\.filter\(\(date\) => inR\(date, range\)\)/);
});

test("performance premeeting count uses the same population as premeeting companies", () => {
  assert.match(source, /const isPremeetingCompanyInRange = \(lead, range\)/);
  const sharedCountUses = source.match(/isPremeetingCompanyInRange\(l, r\)/g) || [];
  assert.ok(sharedCountUses.length >= 2, "premeeting companies and performance views must share the predicate");
  assert.match(source, /const pre = db\.leads\.filter\(\(l\) => isPremeetingCompanyInRange\(l, r\) && matchesCustomerType\(l\)\)/);
});
