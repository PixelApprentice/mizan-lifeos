import { assertTaskStatus, type TaskStatus } from "./taskRules.ts";

export const TASK_POSITION_GAP = 1024;
export interface OrderedTask {
  id: number;
  status: string;
  parent_id: number | null;
  position?: number;
}
export interface TaskMove {
  id: number;
  status: string;
  targetId?: number;
  placement?: "before" | "after";
}
export interface TaskPlacement { id: number; status: TaskStatus; position: number }

export function compareTaskOrder(a: Pick<OrderedTask, "id" | "position">, b: Pick<OrderedTask, "id" | "position">): number {
  const position = (task: typeof a) => Number.isFinite(task.position) ? task.position! : 0;
  return position(a) - position(b) || a.id - b.id;
}

export function nextTaskPosition(tasks: readonly OrderedTask[], status: string, parentId: number | null): number {
  return Math.max(0, ...tasks.filter((task) => task.status === status && task.parent_id === parentId).map((task) => task.position ?? 0)) + TASK_POSITION_GAP;
}

// Anchor against the full lane, not just filtered cards. Hidden tasks keep their relative order.
export function planTaskMove(tasks: readonly OrderedTask[], move: TaskMove): TaskPlacement[] {
  assertTaskStatus(move.status);
  if (move.placement !== undefined && move.placement !== "before" && move.placement !== "after") throw new Error("Choose before or after the target task.");
  const task = tasks.find((item) => item.id === move.id);
  if (!task) throw new Error("Task no longer exists.");
  assertTaskStatus(task.status);
  if (move.targetId === task.id) return [];
  const siblings = tasks.filter((item) => item.parent_id === task.parent_id);
  const source = siblings.filter((item) => item.status === task.status).sort(compareTaskOrder);
  const destination = siblings.filter((item) => item.status === move.status && item.id !== task.id).sort(compareTaskOrder);
  let index = destination.length;
  if (move.targetId !== undefined) {
    index = destination.findIndex((item) => item.id === move.targetId);
    if (index < 0) throw new Error("The drop target changed. Try moving the task again.");
    if (move.placement === "after") index++;
  }
  destination.splice(index, 0, task);
  if (task.status === move.status && destination.every((item, i) => item.id === source[i]?.id)) return [];
  const lanes = task.status === move.status
    ? [{ tasks: destination, status: move.status }]
    : [{ tasks: source.filter((item) => item.id !== task.id), status: task.status }, { tasks: destination, status: move.status }];
  return lanes.flatMap((lane) => lane.tasks.flatMap((item, i) => {
    const position = (i + 1) * TASK_POSITION_GAP;
    return item.status === lane.status && item.position === position ? [] : [{ id: item.id, status: lane.status, position }];
  }));
}

export function taskMoveStatement(moves: readonly TaskPlacement[], now: string): { sql: string; values: (number | string)[] } {
  if (!moves.length || new Set(moves.map((move) => move.id)).size !== moves.length) throw new Error("Choose distinct tasks to reorder.");
  const values: (number | string)[] = [];
  const rows = moves.map((move) => {
    assertTaskStatus(move.status);
    if (!Number.isSafeInteger(move.id) || move.id <= 0 || !Number.isFinite(move.position)) throw new Error("Invalid task position.");
    const start = values.length;
    values.push(move.id, move.status, move.position);
    return `($${start + 1},$${start + 2},$${start + 3})`;
  });
  values.push(now);
  const status = "(SELECT status FROM moved WHERE moved.id=tasks.id)";
  return {
    sql: `WITH moved(id,status,position) AS (VALUES ${rows.join(",")})
      UPDATE tasks SET
        completed_at=CASE WHEN ${status}='done' THEN CASE WHEN tasks.status='done' THEN tasks.completed_at ELSE $${values.length} END ELSE NULL END,
        status=${status},
        position=(SELECT position FROM moved WHERE moved.id=tasks.id)
      WHERE id IN (SELECT id FROM moved)
        AND (SELECT COUNT(*) FROM tasks WHERE id IN (SELECT id FROM moved))=${moves.length}`,
    values,
  };
}
