import test from "node:test";
import assert from "node:assert/strict";
import { initialRanks, rankBetween, rankForDrop } from "./rank.ts";

test("ranks always land strictly between their neighbours", () => {
  const cases = [[null, null], ["a", null], [null, "a"], ["0", "1"], ["0i", "0j"], ["a", "a0001"], ["z", null], [null, "01"]];
  for (const [a, b] of cases) {
    const r = rankBetween(a, b);
    if (a !== null) assert.ok(r > a, `${r} > ${a}`);
    if (b !== null) assert.ok(r < b, `${r} < ${b}`);
    assert.ok(!r.endsWith("0"), `${r} has no trailing zero`);
  }
});

test("repeated inserts at the same spot keep order", () => {
  let lo = "a", hi = "b";
  const seen = [];
  for (let i = 0; i < 300; i++) {
    const r = rankBetween(lo, hi);
    assert.ok(lo < r && r < hi);
    seen.push(r);
    hi = r;
  }
  for (let i = 0; i < 300; i++) lo = rankBetween(lo, null);
  assert.ok(lo > "a");
  assert.throws(() => rankBetween("b", "a"));
});

test("initial ranks are sorted and drops fit between cards", () => {
  const ranks = initialRanks(50);
  assert.deepEqual([...ranks].sort(), ranks);
  assert.equal(new Set(ranks).size, 50);
  const list = ranks.slice(0, 3).map((rank) => ({ rank }));
  const r = rankForDrop(list, 1, "before");
  assert.ok(list[0].rank < r && r < list[1].rank);
  assert.ok(rankForDrop(list, 2, "after") > list[2].rank);
  assert.ok(rankForDrop([], 0, "before").length > 0);
});
