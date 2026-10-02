// Typed data layer for tasks, projects and calendar events.
// Real app: SQLite via tauri-plugin-sql. Demo (plain browser): the in-memory `demo` store.
import { db, demo, IS_TAURI, type CalEvent, type Project, type Task } from "./api";
import { compareTaskOrder, nextTaskPosition, planTaskMove, taskMoveStatement, TASK_POSITION_GAP, type TaskMove } from "./taskOrder.ts";
import { taskCompletionTime, validateTaskFields } from "./taskRules.ts";
import { taskStepsStatement, validateTaskSteps, type BreakdownStep } from "./taskBreakdown.ts";

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("mizan-data");
channel?.addEventListener("message", () => window.dispatchEvent(new Event("mizan:data-changed")));
function changed() {
  window.dispatchEvent(new Event("mizan:data-changed"));
  channel?.postMessage("changed");
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
  if (!IS_TAURI) return demo.tasks.map((task) => ({ ...task })).sort(compareTaskOrder);
  const d = await db();
  return d.select<Task[]>("SELECT * FROM tasks ORDER BY parent_id NULLS FIRST, position ASC, id ASC");
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

export async function addTask(t: NewTask): Promise<number> {
  validateTaskFields(t);
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
  const now = new Date().toISOString();
  if (!IS_TAURI) {
    if (row.parent_id !== null && !demo.tasks.some((task) => task.id === row.parent_id)) throw new Error("Parent task no longer exists.");
    const id = demo.nextId++;
    demo.tasks.push({
      id, notes: "", created_at: now, ...row,
      position: nextTaskPosition(demo.tasks, row.status, row.parent_id),
      completed_at: taskCompletionTime({ status: "open" }, row.status, now),
    });
    changed();
    return id;
  }
  const d = await db();
  const result = await d.execute(
    `INSERT INTO tasks (title,kind,est_min,parent_id,project_id,priority,status,due,position,completed_at,created_at)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,
       (SELECT COALESCE(MAX(position),0)+${TASK_POSITION_GAP} FROM tasks WHERE status=$7 AND parent_id IS $4),
       CASE WHEN $7='done' THEN $9 ELSE NULL END,$9
     WHERE $4 IS NULL OR EXISTS (SELECT 1 FROM tasks WHERE id=$4)`,
    [row.title, row.kind, row.est_min, row.parent_id, row.project_id, row.priority, row.status, row.due, now],
  );
  if (!result.rowsAffected) throw new Error("Parent task no longer exists.");
  changed();
  if (result.lastInsertId === undefined) throw new Error("The task was saved but its id was not returned. Reload to see it.");
  return result.lastInsertId;
}

export async function updateTask(id: number, patch: TaskPatch): Promise<void> {
  validateTaskFields(patch);
  const clean: TaskPatch = Object.fromEntries(Object.entries(patch).filter(([key, value]) => TASK_COLS.some((column) => column === key) && value !== undefined));
  if (clean.title !== undefined) clean.title = clean.title.trim();
  if (clean.due === "") clean.due = null;
  if (!Object.keys(clean).length) return;
  const now = new Date().toISOString();
  if (!IS_TAURI) {
    const t = demo.tasks.find((x) => x.id === id);
    if (!t) throw new Error("Task no longer exists.");
    if (clean.status !== undefined) {
      if (clean.status !== t.status) t.position = nextTaskPosition(demo.tasks, clean.status, t.parent_id);
      t.completed_at = taskCompletionTime(t, clean.status, now);
    }
    Object.assign(t, clean);
    changed();
    return;
  }
  const { status, ...fields } = clean;
  const { sql, values } = setClause(fields, TASK_COLS);
  const assignments = sql ? [sql] : [];
  if (status !== undefined) {
    values.push(status, now);
    const value = `$${values.length - 1}`;
    assignments.push(
      `completed_at=CASE WHEN ${value}='done' THEN CASE WHEN status='done' THEN completed_at ELSE $${values.length} END ELSE NULL END`,
      `position=CASE WHEN status=${value} THEN position ELSE (SELECT COALESCE(MAX(lane.position),0)+${TASK_POSITION_GAP} FROM tasks AS lane WHERE lane.status=${value} AND lane.parent_id IS tasks.parent_id AND lane.id<>tasks.id) END`,
      `status=${value}`,
    );
  }
  const d = await db();
  const result = await d.execute(`UPDATE tasks SET ${assignments.join(", ")} WHERE id=$${values.length + 1}`, [...values, id]);
  if (!result.rowsAffected) throw new Error("Task no longer exists.");
  changed();
}

export async function reorderTask(id: number, destination: Omit<TaskMove, "id">): Promise<void> {
  const moves = planTaskMove(await listTasks(), { id, ...destination });
  if (!moves.length) return;
  const now = new Date().toISOString();
  if (!IS_TAURI) {
    for (const move of moves) {
      const task = demo.tasks.find((item) => item.id === move.id)!;
      Object.assign(task, { completed_at: taskCompletionTime(task, move.status, now) }, move);
    }
  } else {
    const d = await db();
    const { sql, values } = taskMoveStatement(moves, now);
    const result = await d.execute(sql, values);
    if (result.rowsAffected !== moves.length) throw new Error("The tasks changed before the move was saved. Try again.");
  }
  changed();
}

export async function addTaskSteps(parentId: number, steps: readonly BreakdownStep[]): Promise<void> {
  const tasks = await listTasks();
  const parent = tasks.find((task) => task.id === parentId);
  if (!parent) throw new Error("Task no longer exists.");
  const validated = validateTaskSteps(parent, steps, tasks);
  const now = new Date().toISOString();
  if (!IS_TAURI) {
    const top = Math.max(0, ...demo.tasks.filter((task) => task.parent_id === parent.id).map((task) => task.position ?? 0));
    const children: Task[] = validated.map((step, i) => ({
      id: demo.nextId++, title: step.title, est_min: step.est_min, notes: "",
      kind: parent.kind, project_id: parent.project_id, priority: parent.priority, due: parent.due,
      parent_id: parent.id, status: parent.status === "backlog" ? "backlog" : "open",
      position: top + (i + 1) * TASK_POSITION_GAP, completed_at: null, created_at: now,
    }));
    demo.tasks.push(...children);
  } else {
    const d = await db();
    const { sql, values } = taskStepsStatement(parentId, validated, now);
    const result = await d.execute(sql, values);
    if (result.rowsAffected !== validated.length) throw new Error("This task is complete or no longer exists. Reload before trying again.");
  }
  changed();
}

/** Deletes every step (and nested step) under a task, keeping the task itself. */
export async function clearTaskSteps(parentId: number): Promise<void> {
  if (!IS_TAURI) {
    for (const child of demo.tasks.filter((task) => task.parent_id === parentId)) await deleteTask(child.id);
    changed();
    return;
  }
  const d = await db();
  const tree = "WITH RECURSIVE tree(id) AS (SELECT id FROM tasks WHERE parent_id=$1 UNION SELECT t.id FROM tasks t JOIN tree ON t.parent_id=tree.id)";
  await d.execute(`${tree} UPDATE events SET task_id=NULL WHERE task_id IN (SELECT id FROM tree)`, [parentId]);
  await d.execute(`${tree} DELETE FROM tasks WHERE id IN (SELECT id FROM tree)`, [parentId]);
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
