import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { extractListedSteps, suggestTaskSteps, taskStepsStatement, validateTaskSteps } from "./taskBreakdown.ts";

const parent = { id: 1, title: "Ship release", kind: "code", status: "open", est_min: 60, priority: 2, project_id: null, due: null };

test("suggested steps never repeat the task title", () => {
  const title = "Fix the login page crash on submit";
  const steps = suggestTaskSteps({ title, kind: "code", est_min: 45 });
  assert.equal(steps.length, 3);
  for (const step of steps) assert.ok(!step.title.includes(title), step.title);
  assert.equal(steps.reduce((sum, step) => sum + step.est_min, 0), 45);
});

test("lists in the title or notes become steps", () => {
  assert.deepEqual(extractListedSteps("Release: write notes, tag build and upload"), ["Write notes", "Tag build", "Upload"]);
  assert.deepEqual(extractListedSteps("fix bugs 1 crash on start, 2 remove mascot, 3 kanban sorting"), ["Crash on start", "Remove mascot", "Kanban sorting"]);
  assert.deepEqual(extractListedSteps("- buy milk\n- call mom\n* pay rent"), ["Buy milk", "Call mom", "Pay rent"]);
  assert.deepEqual(extractListedSteps("Study for 2 hours"), []);
  const steps = suggestTaskSteps({ title: "Weekend", kind: "other", est_min: 30, notes: "1. laundry\n2. groceries\n3. clean desk" });
  assert.deepEqual(steps.map((step) => step.title), ["Laundry", "Groceries", "Clean desk"]);
});

test("steps can be added to a task that already has steps, but not duplicated", () => {
  const tasks = [{ parent_id: 1, title: "Write notes" }];
  assert.deepEqual(validateTaskSteps(parent, [{ title: "Tag build", est_min: 5 }], tasks), [{ title: "Tag build", est_min: 5 }]);
  assert.throws(() => validateTaskSteps(parent, [{ title: "write  notes", est_min: 5 }], tasks), /already exists/);
  assert.throws(() => validateTaskSteps({ ...parent, status: "done" }, [{ title: "x", est_min: 5 }], []), /Reopen/);
});

test("step insert appends after existing steps and inherits parent fields", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, kind TEXT, status TEXT, parent_id INTEGER, est_min INTEGER,
    project_id INTEGER, priority INTEGER, due TEXT, position REAL, completed_at TEXT, created_at TEXT)`);
  db.prepare("INSERT INTO tasks (id,title,kind,status,parent_id,est_min,priority,position) VALUES (1,'Ship','code','backlog',NULL,60,1,1000)").run();
  db.prepare("INSERT INTO tasks (id,title,kind,status,parent_id,est_min,priority,position) VALUES (2,'Old','code','backlog',1,5,1,3000)").run();
  const { sql, values } = taskStepsStatement(1, [{ title: "A", est_min: 10 }, { title: "B", est_min: 15 }], "2026-01-01T00:00:00.000Z");
  const result = db.prepare(sql.replace(/\$(\d+)/g, "?$1")).run(...values);
  assert.equal(result.changes, 2);
  const rows = db.prepare("SELECT title,status,kind,priority,position FROM tasks WHERE parent_id=1 ORDER BY position").all();
  assert.deepEqual(rows.map((row) => row.title), ["Old", "A", "B"]);
  assert.ok(rows[1].position > 3000 && rows[2].position > rows[1].position);
  assert.equal(rows[1].status, "backlog");
  assert.equal(rows[1].priority, 1);
  db.prepare("UPDATE tasks SET status='done' WHERE id=1").run();
  assert.equal(db.prepare(sql.replace(/\$(\d+)/g, "?$1")).run(...values).changes, 0);
});
