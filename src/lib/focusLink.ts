import type { Task } from "./api";

// Opens Focus with the goal and length already filled in from a task.
export const focusLink = (task: Pick<Task, "title" | "est_min">) =>
  `/focus?goal=${encodeURIComponent(task.title)}&min=${Math.max(5, Math.min(480, Math.round(task.est_min || 25)))}`;
