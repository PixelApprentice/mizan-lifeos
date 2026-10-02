import test from "node:test";
import assert from "node:assert/strict";
import { burndown, cycleTime, throughput, velocity, weekOf, workload } from "./reports.ts";
import { buildModel, can, filterIssues, statusFields, suggestKey } from "./model.ts";
import { activity, inbox } from "./inbox.ts";

const issue = (o) => ({ id: o.id, project_id: "p", number: 1, type: "task", title: "t", description: "", status: "todo", priority: 0, assignee: null, reporter: "a", estimate: null, due: null, labels: [], checklist: [], parent_id: null, sprint_id: null, rank: "m", resolved_at: null, created_at: "2025-01-01T00:00:00Z", ...o });
const sprint = { id: "s", project_id: "p", name: "Sprint 1", goal: "", start: "2025-01-06", end: "2025-01-10", state: "active", closed_at: null };

test("burndown subtracts work on the day it was done", () => {
  const issues = [issue({ id: "1", sprint_id: "s", estimate: 3, status: "done", resolved_at: "2025-01-07T10:00:00Z" }), issue({ id: "2", sprint_id: "s", estimate: 5 }), issue({ id: "3", estimate: 8 })];
  const b = burndown(sprint, issues, new Date("2025-01-08T12:00:00Z"));
  assert.equal(b.length, 5);
  assert.deepEqual(b.map((p) => p.remaining).slice(0, 3), [8, 5, 5]);
  assert.ok(Number.isNaN(b[4].remaining), "future days are blank");
  assert.equal(b[0].ideal, 8);
  assert.equal(b[4].ideal, 0);
});

test("velocity, throughput, cycle time and workload", () => {
  const closed = { ...sprint, state: "closed" };
  const issues = [
    issue({ id: "1", sprint_id: "s", status: "done", resolved_at: "2025-01-08T00:00:00Z", created_at: "2025-01-06T00:00:00Z" }),
    issue({ id: "2", sprint_id: "s", status: "todo", assignee: "bo", due: "2000-01-01" }),
    issue({ id: "3", status: "done", resolved_at: "2025-01-09T00:00:00Z", created_at: "2025-01-05T00:00:00Z" }),
  ];
  assert.deepEqual(velocity([closed], issues), [{ sprint: "Sprint 1", done: 1, committed: 2 }]);
  assert.equal(weekOf(new Date("2025-01-12T00:00:00Z")), "2025-01-06");
  const t = throughput(issues, 2, new Date("2025-01-10T00:00:00Z"));
  assert.deepEqual(t, [{ week: "2024-12-30", done: 0 }, { week: "2025-01-06", done: 2 }]);
  assert.equal(cycleTime(issues, 60, new Date("2025-01-10T00:00:00Z")), 3);
  assert.deepEqual(workload(issues), [{ assignee: "bo", open: 1, estimate: 0, overdue: 1 }]);
});

const state = {
  pending: 0,
  workspace: { id: "w", name: "Acme", mode: "host", me: "a", role: "member", pending: 0, last_sync: "", error: "", host: "" },
  rows: [
    { entity: "member", id: "a", data: { name: "Amina", role: "member", active: true } },
    { entity: "member", id: "b", data: { name: "Bilal", role: "admin", active: true } },
    { entity: "project", id: "p", data: { key: "WEB", name: "Website", lead: "b" } },
    { entity: "issue", id: "i1", data: { project_id: "p", number: 7, title: "Login page", status: "todo", reporter: "a", rank: "b", labels: ["auth"] } },
    { entity: "issue", id: "i2", data: { project_id: "p", number: 8, title: "Gone", deleted: true } },
    { entity: "comment", id: "c1", data: { issue_id: "i1", body: "@amina can you check?", author: "b", created_at: "2025-01-02" } },
  ],
  ops: [
    { seq: 1, op_id: "o1", member: "a", hlc: "", entity: "issue", id: "i1", kind: "create", fields: { title: "Login page" }, at: "2025-01-01" },
    { seq: 2, op_id: "o2", member: "b", hlc: "", entity: "issue", id: "i1", kind: "set", fields: { assignee: "a" }, at: "2025-01-02" },
    { seq: 3, op_id: "o3", member: "b", hlc: "", entity: "comment", id: "c1", kind: "create", fields: { issue_id: "i1", body: "@amina can you check?" }, at: "2025-01-02" },
    { seq: 4, op_id: "o4", member: "b", hlc: "", entity: "issue", id: "i1", kind: "set", fields: { status: "in_review", rank: "c" }, at: "2025-01-03" },
  ],
};

test("model, permissions, inbox and activity", () => {
  const m = buildModel(state);
  assert.equal(m.issues.length, 1, "deleted issues are hidden");
  assert.equal(m.comments.get("i1").length, 1);
  assert.ok(can(m, "edit-issues"));
  assert.ok(!can(m, "manage-sprints", { projectId: "p" }), "members who are not lead cannot run sprints");
  assert.ok(can(m, "delete-issue", { issue: m.issues[0] }), "reporters may delete their own issue");
  const items = inbox(m);
  assert.deepEqual(items.map((i) => i.kind), ["status", "mention", "assigned"]);
  assert.match(items[2].text, /Bilal assigned you WEB-7/);
  assert.deepEqual(activity(m, "i1").map((a) => a.text), ["moved to In review", "assigned Amina", "created the issue"]);
  assert.equal(filterIssues(m.issues, { text: "auth" }, m.projectById).length, 1);
  assert.equal(filterIssues(m.issues, { status: "open", assignee: "none" }, m.projectById).length, 1);
  assert.equal(filterIssues(m.issues, { text: "web-7" }, m.projectById).length, 1);
});

test("status fields and key suggestions", () => {
  assert.ok(statusFields({ status: "todo", resolved_at: null }, "done").resolved_at);
  assert.equal(statusFields({ status: "done", resolved_at: "x" }, "todo").resolved_at, null);
  assert.ok(!("resolved_at" in statusFields({ status: "todo", resolved_at: null }, "in_progress")));
  assert.equal(suggestKey("Mobile App"), "MA");
  assert.equal(suggestKey("Website"), "WEB");
  assert.equal(suggestKey("2025 plan"), "P2P");
});
