import test from "node:test";
import assert from "node:assert/strict";
import { durationMinutes, focusRemainingSec, sessionRecord } from "./focusTime.ts";

const session = {
  started_at: "2030-01-01T10:00:00Z", ends_at: "2030-01-01T11:20:00Z",
  planned_min: 50, paused_at: "2030-01-01T11:00:00Z", kills: 0,
};
test("timer freezes during pause and excludes earlier pauses from actual minutes", () => {
  assert.equal(focusRemainingSec(session, Date.parse("2030-01-01T12:00:00Z")), 1200);
  assert.equal(sessionRecord(session, Date.parse("2030-01-01T12:00:00Z"), true).actual_min, 30);
});
test("late watcher cannot inflate completed focus time", () => {
  assert.equal(sessionRecord({ ...session, paused_at: null }, Date.parse("2030-01-01T12:00:00Z"), false).actual_min, 50);
});
test("fractional seconds do not finish a timer early", () => {
  assert.equal(focusRemainingSec({ ...session, paused_at: null }, Date.parse("2030-01-01T11:19:59.800Z")), 1);
});
test("duration wheels respect five minute and eight hour limits", () => {
  assert.equal(durationMinutes(0, 0), 5);
  assert.equal(durationMinutes(8, 59), 480);
  assert.equal(durationMinutes(1, 25), 85);
  assert.throws(() => durationMinutes(1.5, 0));
});
