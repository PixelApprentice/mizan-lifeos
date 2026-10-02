import test from "node:test";
import assert from "node:assert/strict";
import { activeStreak, lastDays, localDay, summarizeStats } from "./stats.ts";

test("localDay understands SQLite local times, offsets and ISO UTC", () => {
  assert.equal(localDay("2026-10-03 23:59:00"), "2026-10-03");
  assert.equal(localDay("2026-10-03T10:40:33.737593375+03:00").length, 10);
  assert.equal(localDay("2026-10-03"), "2026-10-03");
  assert.equal(localDay("nonsense"), null);
  assert.equal(localDay(null), null);
});

test("lastDays crosses month boundaries", () => {
  assert.deepEqual(lastDays("2026-03-02", 3), ["2026-02-28", "2026-03-01", "2026-03-02"]);
});

test("streak tolerates an empty today but stops at a gap", () => {
  const active = new Set(["2026-10-01", "2026-10-02", "2026-10-04"]);
  assert.equal(activeStreak((d) => active.has(d), "2026-10-03"), 2);
  assert.equal(activeStreak((d) => active.has(d), "2026-10-04"), 1);
  assert.equal(activeStreak((d) => active.has(d), "2026-10-06"), 0);
});

test("summary combines focus sessions and completed tasks", () => {
  const sessions = [
    { started_at: "2026-10-03 10:00:00", actual_min: 90, planned_min: 90, broken: false, phone_leaves: 2 },
    { started_at: "2026-10-02 10:00:00", actual_min: 10, planned_min: 50, broken: true },
    { started_at: "2026-09-01 10:00:00", actual_min: 25, planned_min: 25, broken: false },
  ];
  const tasks = [
    { status: "done", kind: "code", due: null, completed_at: "2026-10-03 12:00:00", parent_id: null },
    { status: "done", kind: "code", due: null, completed_at: null, parent_id: null },
    { status: "open", kind: "study", due: "2026-10-01", parent_id: null },
    { status: "doing", kind: "study", due: null, parent_id: null },
  ];
  const s = summarizeStats(sessions, tasks, "2026-10-03");
  assert.equal(s.focusWeekMin, 100);
  assert.equal(s.focusTotalMin, 125);
  assert.equal(s.completionRate, 67);
  assert.equal(s.averageMin, 58);
  assert.equal(s.phoneChecks, 2);
  assert.equal(s.focusStreak, 2);
  assert.equal(s.doneWeek, 1);
  assert.equal(s.doneTotal, 2);
  assert.equal(s.open, 2);
  assert.equal(s.doing, 1);
  assert.equal(s.overdue, 1);
  assert.deepEqual(s.byKind, [["code", 2]]);
});
