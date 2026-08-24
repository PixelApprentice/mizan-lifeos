// Typed data layer for tasks, projects and calendar events.
// Real app: SQLite via tauri-plugin-sql. Demo (plain browser): the in-memory `demo` store.
import { db, demo, IS_TAURI, type CalEvent, type Project, type Task } from "./api";

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("mizan-data");
channel?.addEventListener("message", () => window.dispatchEvent(new Event("mizan:data-changed")));
function changed() {
  window.dispatchEvent(new Event("mizan:data-changed"));
  channel?.postMessage("changed");
}
function validateTask(task: { title?: string; due?: string | null; est_min?: number; priority?: number }) {
  if (task.title !== undefined && !task.title.trim()) throw new Error("Task title is required.");
  if (task.est_min !== undefined && (!Number.isInteger(task.est_min) || task.est_min < 5)) throw new Error("Estimate must be a whole number of at least 5 minutes.");
  if (task.priority !== undefined && ![1, 2, 3].includes(task.priority)) throw new Error("Choose high, normal, or low priority.");
  if (task.due && (!/^\d{4}-\d{2}-\d{2}$/.test(task.due) || !Number.isFinite(Date.parse(task.due)))) throw new Error("Choose a valid due date.");
}
function validateEvent(event: { title: string; start: string; end: string }) {
  if (!event.title.trim()) throw new Error("Event title is required.");
  const start = Date.parse(event.start), end = Date.parse(event.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Event end must be after its start. Choose the next end date for overnight events.");
}

type TaskPatch = Partial<Pick<Task, "title" | "notes" | "kind" | "status" | "est_min" | "due" | "project_id" | "priority">>;
type ProjectPatch = Partial<Pick<Project, "name" | "goal" | "color" | "due" | "status">>;
type EventPatch = Partial<Pick<CalEvent, "title" | "start" | "end" | "color" | "done" | "task_id">>;

// Only whitelisted column names ever reach the SQL string; values are always bound.
function setClause(patch: Record<string, unknown>, allowed: readonly string[]) {
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  return {
    sql: keys.map((k, i) => `${k}=$${i + 1}`).join(", "),
    values: keys.map((k) => patch[k] ?? null),
  };
}

const TASK_COLS = ["title", "notes", "kind", "status", "est_min", "due", "project_id", "priority"] as const;
const PROJECT_COLS = ["name", "goal", "color", "due", "status"] as const;
const EVENT_COLS = ["title", "start", "end", "color", "done", "task_id"] as const;

// ---------------- tasks ----------------

export async function listTasks(): Promise<Task[]> {
  if (!IS_TAURI) return [...demo.tasks];
  const d = await db();
  return d.select<Task[]>("SELECT * FROM tasks ORDER BY parent_id NULLS FIRST, priority ASC, created_at DESC");
}

export interface NewTask {
  title: string;
  kind?: string;
  est_min?: number;
  parent_id?: number | null;
  project_id?: number | null;
  priority?: number;
  status?: string;
  due?: string | null;
}

export async function addTask(t: NewTask): Promise<void> {
  validateTask(t);
  const row = {
    title: t.title.trim(),
    kind: t.kind ?? "code",
    est_min: t.est_min ?? 25,
    parent_id: t.parent_id ?? null,
    project_id: t.project_id ?? null,
    priority: t.priority ?? 2,
    status: t.status ?? "open",
    due: t.due || null,
  };
  if (!IS_TAURI) {
    demo.tasks.push({ id: demo.nextId++, notes: "", created_at: new Date().toISOString(), ...row });
    changed();
    return;
  }
  const d = await db();
  await d.execute(
    "INSERT INTO tasks (title, kind, est_min, parent_id, project_id, priority, status, due) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [row.title, row.kind, row.est_min, row.parent_id, row.project_id, row.priority, row.status, row.due],
  );
  changed();
}

export async function updateTask(id: number, patch: TaskPatch): Promise<void> {
  validateTask(patch);
  if (!IS_TAURI) {
    const t = demo.tasks.find((x) => x.id === id);
    if (!t) throw new Error("Task no longer exists.");
    Object.assign(t, patch);
    changed();
    return;
  }
  const { sql, values } = setClause(patch, TASK_COLS);
  if (!sql) return;
  const d = await db();
  await d.execute(`UPDATE tasks SET ${sql} WHERE id=$${values.length + 1}`, [...values, id]);
  changed();
}

export async function deleteTask(id: number): Promise<void> {
  if (!IS_TAURI) {
    const removed = new Set([id]);
    let size = 0;
    while (size !== removed.size) {
      size = removed.size;
      for (const t of demo.tasks) if (t.parent_id !== null && removed.has(t.parent_id)) removed.add(t.id);
    }
    demo.tasks = demo.tasks.filter((x) => !removed.has(x.id));
    demo.events.forEach((e) => { if (e.task_id !== null && removed.has(e.task_id)) e.task_id = null; });
    changed();
    return;
  }
  const d = await db();
  const descendants = "WITH RECURSIVE tree(id) AS (SELECT id FROM tasks WHERE id=$1 UNION SELECT t.id FROM tasks t JOIN tree ON t.parent_id=tree.id)";
  await d.execute(`${descendants} UPDATE events SET task_id=NULL WHERE task_id IN (SELECT id FROM tree)`, [id]);
  await d.execute(`${descendants} DELETE FROM tasks WHERE id IN (SELECT id FROM tree)`, [id]);
  changed();
}

// ---------------- projects ----------------

export async function listProjects(): Promise<Project[]> {
  if (!IS_TAURI) return [...demo.projects];
  const d = await db();
  return d.select<Project[]>("SELECT * FROM projects ORDER BY status ASC, created_at ASC");
}

export async function addProject(p: { name: string; goal?: string; color?: string; due?: string | null }): Promise<void> {
  const name = p.name.trim();
  if (!name) throw new Error("Project name is required.");
  if (!IS_TAURI) {
    demo.projects.push({
      id: demo.nextId++,
      name,
      goal: p.goal ?? "",
      color: p.color ?? "#34d399",
      due: p.due ?? null,
      status: "active",
      created_at: new Date().toISOString(),
    });
    changed();
    return;
  }
  const d = await db();
  await d.execute("INSERT INTO projects (name, goal, color, due) VALUES ($1,$2,$3,$4)", [
    name,
    p.goal ?? "",
    p.color ?? "#34d399",
    p.due ?? null,
  ]);
  changed();
}

export async function updateProject(id: number, patch: ProjectPatch): Promise<void> {
  if (patch.name !== undefined && !patch.name.trim()) throw new Error("Project name is required.");
  if (!IS_TAURI) {
    const p = demo.projects.find((x) => x.id === id);
    if (!p) throw new Error("Project no longer exists.");
    Object.assign(p, patch);
    changed();
    return;
  }
  const { sql, values } = setClause(patch, PROJECT_COLS);
  if (!sql) return;
  const d = await db();
  await d.execute(`UPDATE projects SET ${sql} WHERE id=$${values.length + 1}`, [...values, id]);
  changed();
}

/** Deleting a project keeps its tasks — they fall back to "no project". */
export async function deleteProject(id: number): Promise<void> {
  if (!IS_TAURI) {
    demo.projects = demo.projects.filter((p) => p.id !== id);
    demo.tasks.forEach((t) => t.project_id === id && (t.project_id = null));
    changed();
    return;
  }
  const d = await db();
  await d.execute("UPDATE tasks SET project_id=NULL WHERE project_id=$1", [id]);
  await d.execute("DELETE FROM projects WHERE id=$1", [id]);
  changed();
}

// ---------------- calendar events ----------------

export async function listEvents(): Promise<CalEvent[]> {
  if (!IS_TAURI) return [...demo.events].sort((a, b) => a.start.localeCompare(b.start));
  const d = await db();
  return d.select<CalEvent[]>("SELECT * FROM events ORDER BY start");
}

export async function addEvent(e: { title: string; start: string; end: string; task_id?: number | null; color?: string }): Promise<void> {
  validateEvent(e);
  if (!IS_TAURI) {
    demo.events.push({ id: demo.nextId++, done: 0, task_id: e.task_id ?? null, color: e.color ?? "", title: e.title, start: e.start, end: e.end });
    changed();
    return;
  }
  const d = await db();
  await d.execute("INSERT INTO events (title, start, end, task_id, color) VALUES ($1,$2,$3,$4,$5)", [
    e.title,
    e.start,
    e.end,
    e.task_id ?? null,
    e.color ?? "",
  ]);
  changed();
}

export async function updateEvent(id: number, patch: EventPatch): Promise<void> {
  const existing = (await listEvents()).find((event) => event.id === id);
  if (!existing) throw new Error("Event no longer exists.");
  validateEvent({ ...existing, ...patch });
  if (!IS_TAURI) {
    const e = demo.events.find((x) => x.id === id);
    if (e) Object.assign(e, patch);
    changed();
    return;
  }
  const { sql, values } = setClause(patch, EVENT_COLS);
  if (!sql) return;
  const d = await db();
  await d.execute(`UPDATE events SET ${sql} WHERE id=$${values.length + 1}`, [...values, id]);
  changed();
}

export async function deleteEvent(id: number): Promise<void> {
  if (!IS_TAURI) {
    demo.events = demo.events.filter((x) => x.id !== id);
    changed();
    return;
  }
  const d = await db();
  await d.execute("DELETE FROM events WHERE id=$1", [id]);
  changed();
}
