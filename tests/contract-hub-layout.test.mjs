import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

test("contract hub exposes grouped and detailed monthly contract views", () => {
  assert.match(source, /계약 리스트/);
  assert.match(source, /담당자별/);
  assert.match(source, /전체 목록/);
  assert.match(source, /업체·채널·프로그램 검색/);
  assert.match(source, /channelGroupName\(l\.channel\)/);
  assert.match(source, /contractRows\.reduce\(\(sum, l\) => sum \+ contractValue\(l\), 0\)/);
});

test("contract hub replaces the truncated recent-contract list", () => {
  assert.doesNotMatch(source, /visibleRecentContracts/);
  assert.doesNotMatch(source, /recentContractLimit/);
  assert.doesNotMatch(source, /setRecentContractLimit/);
});
