import test from "node:test";
import assert from "node:assert/strict";
import { FAITH, GENERAL, defaultRoutine, keyFor, maxScore, parseRoutine, scoreDay, visibleOn } from "./routine.ts";

test("neutral routine for new people, original for people already tracking it", () => {
  assert.equal(defaultRoutine([]).preset, "general");
  assert.equal(defaultRoutine([{ date: "2025-01-01", movement: "1" }]).preset, "general");
  assert.equal(defaultRoutine([{ date: "2025-01-01", quran_min: "30" }]).preset, "faith");
  assert.ok(!GENERAL.items.some((i) => /quran|fajr|dsa|islamic|birr/.test(i.key)), "general preset has no personal items");
});

test("item scoring uses weekday and weekend targets", () => {
  const monday = { date: "2025-01-06", sleep_on_time: "1", movement: "1", build_min: "90", reading_min: "10", family_call: "0", no_junk_spend: "1" };
  const r = scoreDay(GENERAL, monday);
  assert.equal(r.max, 6);
  assert.equal(r.score, 4);
  assert.deepEqual(r.failed, ["reading minutes", "connected with family or a friend"]);
  const saturday = { ...monday, date: "2025-01-04", build_min: "60" };
  assert.ok(!scoreDay(GENERAL, saturday).failed.includes("deep work minutes"));
  assert.equal(maxScore(FAITH), 9);
  assert.equal(scoreDay(FAITH, { date: "2025-01-06" }).max, 9);
});

test("stored routines are validated and keys are safe CSV columns", () => {
  assert.equal(parseRoutine("not json", GENERAL), GENERAL);
  assert.equal(parseRoutine(JSON.stringify({ items: [{ key: "date", label: "x", type: "bool" }] }), GENERAL), GENERAL);
  const custom = parseRoutine(JSON.stringify({ preset: "custom", scoring: "items", items: [{ key: "drink_water", label: "Drink water", type: "bool", scored: true }] }), GENERAL);
  assert.equal(custom.items[0].key, "drink_water");
  assert.equal(keyFor("Drink water!", []), "drink_water");
  assert.equal(keyFor("Drink water", ["drink_water"]), "drink_water_2");
  assert.equal(keyFor("10k steps", []), "habit_10k_steps");
  assert.equal(keyFor("Score", []), "my_score");
  assert.match(keyFor("Ünïcode ☕", []), /^[a-z][a-z0-9_]*$/);
  assert.ok(visibleOn(FAITH.items.at(-1), "2025-01-03"), "weigh-in shows on Friday");
  assert.ok(!visibleOn(FAITH.items.at(-1), "2025-01-06"));
});
