export interface StatSession { started_at: string; actual_min: number; planned_min: number; broken: boolean; phone_leaves?: number; kills?: number }
export interface StatTask { status: string; kind: string; due: string | null; completed_at?: string | null; parent_id: number | null }

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local calendar day of a stored timestamp. SQLite `datetime('now','localtime')` values are already local. */
export function localDay(stamp: string | null | undefined): string | null {
  if (!stamp) return null;
  const text = stamp.trim();
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(text)) return text.slice(0, 10);
  const time = Date.parse(text);
  return Number.isFinite(time) ? ymd(new Date(time)) : null;
}

/** The last `count` days ending at `today` (YYYY-MM-DD), oldest first. */
export function lastDays(today: string, count: number): string[] {
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => ymd(new Date(y, m - 1, d - (count - 1 - i))));
}

export function focusByDay(sessions: readonly StatSession[]) {
  const days = new Map<string, { minutes: number; sessions: number; finished: number }>();
  for (const session of sessions) {
    const day = localDay(session.started_at);
    if (!day) continue;
    const entry = days.get(day) ?? { minutes: 0, sessions: 0, finished: 0 };
    entry.minutes += Math.max(0, Number(session.actual_min) || 0);
    entry.sessions++;
    if (!session.broken) entry.finished++;
    days.set(day, entry);
  }
  return days;
}

export function tasksDoneByDay(tasks: readonly StatTask[]) {
  const days = new Map<string, number>();
  for (const task of tasks) {
    if (task.status !== "done") continue;
    const day = localDay(task.completed_at);
    if (day) days.set(day, (days.get(day) ?? 0) + 1);
  }
  return days;
}

/** Consecutive active days ending today, or yesterday if today has no activity yet. */
export function activeStreak(active: (day: string) => boolean, today: string): number {
  const days = lastDays(today, 3660).reverse();
  let i = active(days[0]) ? 0 : 1;
  let count = 0;
  while (i < days.length && active(days[i])) { count++; i++; }
  return count;
}

export function summarizeStats(sessions: readonly StatSession[], tasks: readonly StatTask[], today: string) {
  const focus = focusByDay(sessions);
  const done = tasksDoneByDay(tasks);
  const week = new Set(lastDays(today, 7));
  const sum = <T,>(map: Map<string, T>, pick: (value: T) => number, keep: (day: string) => boolean) =>
    [...map].reduce((total, [day, value]) => total + (keep(day) ? pick(value) : 0), 0);
  const finished = sessions.filter((session) => !session.broken);
  const open = tasks.filter((task) => task.status !== "done");
  const byKind = new Map<string, number>();
  for (const task of tasks) if (task.status === "done") byKind.set(task.kind, (byKind.get(task.kind) ?? 0) + 1);
  return {
    focusWeekMin: sum(focus, (v) => v.minutes, (day) => week.has(day)),
    focusTotalMin: sum(focus, (v) => v.minutes, () => true),
    sessions: sessions.length,
    finished: finished.length,
    completionRate: sessions.length ? Math.round(100 * finished.length / sessions.length) : null,
    averageMin: finished.length ? Math.round(finished.reduce((total, s) => total + (Number(s.actual_min) || 0), 0) / finished.length) : 0,
    phoneChecks: sessions.reduce((total, s) => total + (s.phone_leaves ?? 0), 0),
    focusStreak: activeStreak((day) => (focus.get(day)?.minutes ?? 0) > 0, today),
    doneWeek: sum(done, (v) => v, (day) => week.has(day)),
    doneTotal: tasks.filter((task) => task.status === "done").length,
    taskStreak: activeStreak((day) => (done.get(day) ?? 0) > 0, today),
    open: open.length,
    doing: open.filter((task) => task.status === "doing").length,
    overdue: open.filter((task) => task.due !== null && task.due < today).length,
    byKind: [...byKind].sort((a, b) => b[1] - a[1]),
    focus,
    done,
  };
}
