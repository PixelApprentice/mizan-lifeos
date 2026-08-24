import test from "node:test";
import assert from "node:assert/strict";
import { autoPlan, parseWindows } from "./plan.ts";

const task = (id, extra = {}) => ({ id, title: `Task ${id}`, priority: 2, status: "open", est_min: 30, due: null, project_id: null, ...extra });
const event = (start, end, title = "Meeting") => ({ id: 1, title, start, end, color: "", task_id: null, done: 0 });

test("work windows reject invalid input instead of silently dropping it", () => {
  for (const input of ["", "25:00-26:00", "09:60-10:00", "11:00-09:00", "09:00-10:00,invalid"]) {
    assert.throws(() => parseWindows(input));
  }
});

test("overlapping work windows merge so tasks cannot be double-booked", () => {
  assert.deepEqual(parseWindows("10:00-12:00,09:00-11:00,12:00-13:00"), [[540, 780]]);
});

test("overnight events from the previous day reserve time", () => {
  const result = autoPlan("2030-01-02", [task(1)], [event("2030-01-01T23:00:00", "2030-01-02T10:00:00")], "09:00-11:00", null, new Map());
  assert.equal(result.placed[0].start, "2030-01-02T10:00:00");
});

test("a user event titled BUILD block still reserves its full duration", () => {
  const result = autoPlan("2030-01-02", [task(1)], [event("2030-01-02T09:00:00", "2030-01-03T02:00:00", "BUILD block")], "09:00-11:00", null, new Map());
  assert.equal(result.placed.length, 0);
  assert.equal(result.unplaced.length, 1);
});

test("priority and task deadlines choose the scheduling order", () => {
  const result = autoPlan("2030-01-02", [task(1, { due: "2030-02-01" }), task(2, { due: "2030-01-03" }), task(3, { priority: 1 })], [], "09:00-12:00", null, new Map());
  assert.deepEqual(result.placed.map((p) => p.task.id), [3, 2, 1]);
});
