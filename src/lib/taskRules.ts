export const TASK_STATUSES = ["backlog", "open", "doing", "done"] as const;
export type TaskStatus = typeof TASK_STATUSES[number];
export const TASK_KINDS = ["code", "study", "deen", "freelance", "school", "other"] as const;

export function assertTaskStatus(value: unknown): asserts value is TaskStatus {
  if (!TASK_STATUSES.some((status) => status === value)) throw new Error("Choose backlog, open, doing, or done.");
}

export function validateTaskFields(task: {
  title?: string;
  kind?: string;
  status?: string;
  due?: string | null;
  est_min?: number;
  priority?: number;
  project_id?: number | null;
  parent_id?: number | null;
}) {
  if (task.title !== undefined && (typeof task.title !== "string" || !task.title.trim())) throw new Error("Task title is required.");
  if (task.kind !== undefined && !TASK_KINDS.some((kind) => kind === task.kind)) throw new Error("Choose a valid task category.");
  if (task.status !== undefined) assertTaskStatus(task.status);
  if (task.est_min !== undefined && (!Number.isInteger(task.est_min) || task.est_min < 5)) throw new Error("Estimate must be a whole number of at least 5 minutes.");
  if (task.priority !== undefined && ![1, 2, 3].includes(task.priority)) throw new Error("Choose high, normal, or low priority.");
  if (task.due) {
    const date = new Date(`${task.due}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(task.due) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== task.due) {
      throw new Error("Choose a valid due date.");
    }
  }
  for (const id of [task.project_id, task.parent_id]) {
    if (id != null && (!Number.isSafeInteger(id) || id <= 0)) throw new Error("Choose an existing project or parent task.");
  }
}

export function taskCompletionTime(task: { status: string; completed_at?: string | null }, status: string, now: string): string | null {
  assertTaskStatus(status);
  if (status !== "done") return null;
  return task.status === "done" ? task.completed_at ?? null : now;
}
