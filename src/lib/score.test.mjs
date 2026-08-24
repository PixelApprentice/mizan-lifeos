import test from "node:test";
import assert from "node:assert/strict";
import { currentStreak, scoreRow } from "./score.ts";

const done = (date) => ({ date, fajr_on_time: "1" });
const qualifies = (row) => row.fajr_on_time === "1";

test("a missing calendar day breaks the streak", () => {
  assert.equal(currentStreak([done("2030-01-01"), done("2030-01-03")], qualifies, "2030-01-03"), 1);
  assert.equal(currentStreak([done("2030-01-01")], qualifies, "2030-01-03"), 0);
});

test("today may be unlogged but future records do not extend a streak", () => {
  assert.equal(currentStreak([done("2030-01-01"), done("2030-01-02"), done("2030-01-04")], qualifies, "2030-01-03"), 2);
});

test("streaks handle year boundaries and failed days without a cycle cap", () => {
  assert.equal(currentStreak([done("2029-12-31"), done("2030-01-01")], qualifies, "2030-01-01"), 2);
  assert.equal(currentStreak([done("2029-12-31"), { date: "2030-01-01" }], qualifies, "2030-01-01"), 0);
  const rows = Array.from({ length: 500 }, (_, i) =>
    done(new Date(Date.UTC(2028, 0, 1) + i * 86400000).toISOString().slice(0, 10)));
  assert.equal(currentStreak(rows, qualifies, rows.at(-1).date), 500);
});

test("saving a routine without filing a log cannot receive a perfect score", () => {
  const row = {
    date: "2030-01-01", fajr_on_time: "1", prayers_5: "1", sleep_on_time: "1",
    quran_min: "60", dsa_min: "60", build_min: "300", consume_min: "0",
    islamic_knowledge_min: "30", movement: "1", family_call: "1", no_junk_spend: "1",
  };
  assert.equal(scoreRow(row).score, 8);
  assert.equal(scoreRow({ ...row, log_filed: "1" }).score, 9);
});
