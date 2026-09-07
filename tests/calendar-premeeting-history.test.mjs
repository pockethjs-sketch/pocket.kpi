import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

test("manual CRM refresh requests the selected period and keeps only premeeting type", () => {
  assert.match(source, /const rangeStart = r \? r\[0\] : "2026-08-01"/);
  assert.match(source, /const rangeEnd = r \? r\[1\] : today/);
  assert.match(source, /Number\(meeting\.mr_type\) === 1/);
});

test("calendar meetings are retained by ms_no instead of replacing one field", () => {
  assert.match(source, /lead\.crmMeetings\.findIndex/);
  assert.match(source, /String\(item && item\.msNo\) === String\(meeting\.ms_no\)/);
  assert.match(source, /lead\.crmMeeting = lead\.crmMeetings\[lead\.crmMeetings\.length - 1\]/);
});

test("contract month filtering considers every stored CRM meeting date", () => {
  assert.match(source, /const crmMeetingDates = \(lead\)/);
  assert.match(source, /crmMeetingDates\(l\)\.filter\(\(date\) => inR\(date, r\)\)/);
});
