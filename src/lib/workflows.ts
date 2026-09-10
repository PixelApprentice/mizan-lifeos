import type { DayInfo, Task } from "./api";

export interface NoteTemplate { id: string; name: string; body: string }
export const STARTER_TEMPLATES: NoteTemplate[] = [
  { id: "daily-plan", name: "Daily plan", body: "## Plan for {{DATE}}\n\nDay {{DAY}} / week {{WEEK}}\n\nMain outcome: {{TITLE}}\n\n- [ ] First step\n- [ ] Second step\n\nNotes:\n{{VALUE}}" },
  { id: "learning-session", name: "Learning session", body: "## Learning: {{TITLE}}\n\n{{DATE}} at {{TIME}}\n\nQuestion to answer:\n{{VALUE}}\n\nPractice:\n- [ ] Try without the tutorial\n- [ ] Explain from memory\n\nWhat I learned:\n\nNext experiment:\n" },
  { id: "meeting", name: "Meeting notes", body: "## {{TITLE}}\n\n{{DATE}} at {{TIME}}\n\nContext:\n{{VALUE}}\n\nDecisions:\n\nActions:\n- [ ] \n" },
  { id: "weekly-review", name: "Weekly review", body: "## Week {{WEEK}} review\n\n{{DATE}} / {{DOW}}\n\nFinished:\n\nUnfinished and why:\n\nKeep:\n\nChange:\n\nNext week's priority: {{TITLE}}\n\n{{VALUE}}" },
];
export const TEMPLATE_VARIABLES = ["DATE", "TIME", "DAY", "WEEK", "DOW", "TITLE", "VALUE"] as const;

export function renderTemplate(body: string, info: Pick<DayInfo, "date" | "day" | "week" | "dow">, title: string, value: string, time: string): string {
  const variables: Record<string, string> = { DATE: info.date, TIME: time, DAY: String(info.day), WEEK: String(info.week), DOW: info.dow, TITLE: title, VALUE: value };
  return body.replace(/\{\{([\s\S]*?)\}\}/g, (_, key: string) => {
    const name = key.trim();
    if (!TEMPLATE_VARIABLES.some((variable) => variable === name)) throw new Error(`Unknown template variable: ${name}. Use ${TEMPLATE_VARIABLES.join(", ")}.`);
    return variables[name];
  });
}

export type TaskScope = "open" | "important" | "due" | "done" | "all";
export interface TaskQuery {
  text: string;
  scope: TaskScope;
  project: string;
  kind: string;
  deadline: "any" | "overdue" | "today" | "next7" | "none";
  sort: "priority" | "due" | "title";
}
export interface SavedTaskView { id: string; name: string; query: TaskQuery }
export const DEFAULT_QUERY: TaskQuery = { text: "", scope: "open", project: "all", kind: "all", deadline: "any", sort: "priority" };

function dayOffset(date: string, count: number): string {
  const day = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) throw new Error("Invalid query date.");
  day.setUTCDate(day.getUTCDate() + count);
  return day.toISOString().slice(0, 10);
}

export function queryTasks(tasks: Task[], query: TaskQuery, today: string): Task[] {
  const lastDay = dayOffset(today, 6);
  const terms = query.text.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const due = (task: Task) => task.due || "9999-12-31";
  return tasks.filter((task) => {
    const text = `${task.title} ${task.notes}`.toLocaleLowerCase();
    if (!terms.every((term) => text.includes(term))) return false;
    if (query.scope === "done" && task.status !== "done") return false;
    if (query.scope !== "done" && query.scope !== "all" && task.status === "done") return false;
    if (query.scope === "important" && task.priority !== 1) return false;
    if (query.scope === "due" && (!task.due || task.due > today)) return false;
    if (query.project === "none" && task.project_id !== null) return false;
    if (!["all", "none"].includes(query.project) && String(task.project_id) !== query.project) return false;
    if (query.kind !== "all" && task.kind !== query.kind) return false;
    if (query.deadline === "overdue" && (!task.due || task.due >= today)) return false;
    if (query.deadline === "today" && task.due !== today) return false;
    if (query.deadline === "next7" && (!task.due || task.due < today || task.due > lastDay)) return false;
    if (query.deadline === "none" && task.due) return false;
    return true;
  }).sort((a, b) => {
    if (query.sort === "title") return a.title.localeCompare(b.title) || a.id - b.id;
    if (query.sort === "due") return due(a).localeCompare(due(b)) || a.priority - b.priority || a.id - b.id;
    return a.priority - b.priority || due(a).localeCompare(due(b)) || a.id - b.id;
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100;
}
export function parseNoteTemplate(raw: string, id: string): NoteTemplate {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !validName(value.name) || typeof value.body !== "string" || !value.body.trim() || value.body.length > 100000) {
    throw new Error("Invalid local note template. Its saved copy was not changed.");
  }
  return { id, name: value.name.trim(), body: value.body };
}
export function parseSavedView(raw: string, id: string): SavedTaskView {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !validName(value.name) || !record(value.query)) throw new Error("Invalid local task view.");
  const q = value.query;
  if (typeof q.text !== "string" || typeof q.project !== "string" || typeof q.kind !== "string" || !["all", "code", "study", "deen", "freelance", "school", "other"].includes(q.kind) ||
    !["all", "none"].includes(q.project) && !/^[1-9]\d*$/.test(q.project)) throw new Error("Invalid local task view filters.");
  const scope = q.scope, deadline = q.deadline, sort = q.sort;
  if (scope !== "open" && scope !== "important" && scope !== "due" && scope !== "done" && scope !== "all") throw new Error("Invalid task status filter.");
  if (deadline !== "any" && deadline !== "overdue" && deadline !== "today" && deadline !== "next7" && deadline !== "none") throw new Error("Invalid task deadline filter.");
  if (sort !== "priority" && sort !== "due" && sort !== "title") throw new Error("Invalid task sort order.");
  return { id, name: value.name.trim(), query: { text: q.text, project: q.project, kind: q.kind, scope, deadline, sort } };
}
