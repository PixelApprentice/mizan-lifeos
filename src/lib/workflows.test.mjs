import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_QUERY, STARTER_TEMPLATES, parseNoteTemplate, parseSavedView, queryTasks, renderTemplate } from "./workflows.ts";

const info = { date: "2030-01-01", day: 1188, week: 170, dow: "Tuesday" };
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, notes: "", priority: 2, status: "open", kind: "other", due: null, project_id: null, ...extra });
const ids = (tasks, query = {}, today = "2026-12-30") => queryTasks(tasks, { ...DEFAULT_QUERY, ...query }, today).map((item) => item.id);

test("templates use the selected date and uncapped LifeOS day", () => {
  assert.equal(renderTemplate("{{DATE}} {{ DAY }} {{WEEK}} {{DOW}} {{TIME}} {{TITLE}} {{VALUE}}", info, "Plan", "Details", "10:00"), "2030-01-01 1188 170 Tuesday 10:00 Plan Details");
  for (const template of STARTER_TEMPLATES) assert.ok(renderTemplate(template.body, info, "Title", "Notes", "10:00").includes(info.date));
});
test("template substitutions are single-pass plain text", () => {
  const text = "<script>throw new Error('never execute')</script> <% javascript %> ${command}";
  assert.equal(renderTemplate("{{TITLE}}\n{{VALUE}}", info, "{{UNKNOWN}}", text, "10:00"), `{{UNKNOWN}}\n${text}`);
  assert.throws(() => renderTemplate("{{UNKNOWN}}", info, "", "", ""), /Unknown template variable/);
});
test("custom templates validate stored data without changing identity", () => {
  assert.deepEqual(parseNoteTemplate(JSON.stringify({ id: "spoof", name: " Notes ", body: "Text" }), "local-id"), { id: "local-id", name: "Notes", body: "Text" });
  for (const raw of ["null", "{}", "[]", '{"name":"","body":"x"}', '{"name":"x","body":""}', "invalid"]) assert.throws(() => parseNoteTemplate(raw, "id"));
});
test("search combines all words across titles and notes with structured filters", () => {
  const tasks = [task(1, { title: "Learn Rust", notes: "Practice ownership", priority: 1, kind: "code", project_id: 2 }), task(2, { title: "Learn Rust", priority: 1 }), task(3, { title: "Learn Rust", notes: "ownership", status: "done" })];
  assert.deepEqual(ids(tasks, { text: " RUST ownership ", scope: "important", kind: "code", project: "2" }), [1]);
  assert.deepEqual(ids(tasks, { project: "none" }), [2]);
  assert.deepEqual(ids(tasks, { scope: "done" }), [3]);
});
test("relative deadlines cross years and re-evaluate without rewriting views", () => {
  const tasks = [task(1, { due: "2026-12-29" }), task(2, { due: "2026-12-30" }), task(3, { due: "2027-01-05" }), task(4, { due: "2027-01-06" }), task(5)];
  assert.deepEqual(ids(tasks, { deadline: "next7" }), [2, 3]);
  assert.deepEqual(ids(tasks, { deadline: "next7" }, "2026-12-31"), [3, 4]);
  assert.deepEqual(ids(tasks, { deadline: "overdue" }), [1]);
  assert.deepEqual(ids(tasks, { deadline: "today" }), [2]);
  assert.deepEqual(ids(tasks, { deadline: "none" }), [5]);
  assert.deepEqual(ids(tasks, { scope: "due" }), [1, 2]);
  assert.throws(() => ids(tasks, {}, "2026-02-30"), /Invalid query date/);
});
test("query sorting is deterministic and does not mutate source tasks", () => {
  const tasks = [task(3, { title: "Beta", due: "2027-01-01" }), task(2, { title: "Alpha", priority: 1 }), task(1, { title: "Alpha", due: "2027-01-01" })];
  assert.deepEqual(ids(tasks), [2, 1, 3]);
  assert.deepEqual(ids(tasks, { sort: "due" }), [1, 3, 2]);
  assert.deepEqual(ids(tasks, { sort: "title" }), [1, 2, 3]);
  assert.deepEqual(tasks.map((task) => task.id), [3, 2, 1]);
});
test("saved views round-trip queries and reject malformed filters", () => {
  const query = { ...DEFAULT_QUERY, deadline: "next7", project: "2", text: "Review" };
  assert.deepEqual(parseSavedView(JSON.stringify({ name: " Review ", query }), "view"), { id: "view", name: "Review", query });
  for (const patch of [{ scope: "bad" }, { deadline: "yesterday" }, { sort: "random" }, { project: "1 OR 1=1" }, { kind: "bad" }, { text: null }]) {
    assert.throws(() => parseSavedView(JSON.stringify({ name: "View", query: { ...query, ...patch } }), "id"));
  }
});
