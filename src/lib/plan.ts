// Planning helpers: day templates, work windows, and the auto-planner that fits open tasks
// into free time on a date — around prayers and everything already on the calendar.
import type { CalEvent, Prayers, Task } from "./api";

export const KIND_COLORS: Record<string, string> = {
  code: "#34d399",
  study: "#60a5fa",
  deen: "#eab308",
  freelance: "#f472b6",
  school: "#a78bfa",
  other: "#82828c",
};
export const TEMPLATE_COLOR = "#26262c";

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function shiftDay(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export type DayKind = "weekday" | "friday" | "weekend";
export function dayKind(date: string): DayKind {
  const w = weekdayOf(date);
  return w === 5 ? "friday" : w === 0 || w === 6 ? "weekend" : "weekday";
}

// Optional generic starter blocks, not a personal schedule.
type Block = [string, string, string];
export const TEMPLATES: Record<DayKind, Block[]> = {
  weekday: [
    ["08:45", "09:00", "Plan the day"],
    ["12:00", "13:00", "Lunch break"],
    ["17:00", "17:15", "Daily review"],
  ],
  friday: [
    ["08:45", "09:00", "Plan the day"],
    ["12:00", "13:00", "Lunch break"],
    ["16:30", "17:00", "Weekly review"],
  ],
  weekend: [
    ["09:45", "10:00", "Plan the day"],
    ["12:00", "13:00", "Lunch break"],
  ],
};

/** Template blocks whose time is meant to be filled with tasks. */
export const isSlotTitle = (title: string) => title === "[Template] Open work window";

export const DEFAULT_WINDOWS: Record<DayKind, string> = {
  weekday: "09:00-12:00,13:00-17:00",
  friday: "09:00-12:00,13:00-16:30",
  weekend: "10:00-12:00,13:00-16:00",
};

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export function parseWindows(spec: string): [number, number][] {
  if (!spec.trim()) throw new Error("Enter at least one work window.");
  const windows: [number, number][] = spec.split(",").map((part) => {
    const match = part.trim().match(/^([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) throw new Error(`Invalid work window: ${part}. Use HH:MM-HH:MM.`);
    const start = toMin(`${match[1]}:${match[2]}`), end = toMin(`${match[3]}:${match[4]}`);
    if (end <= start) throw new Error("Work windows must end after they start on the same day.");
    return [start, end];
  });
  windows.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of windows) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

// "5:05 AM" → minutes since midnight
function prayerMin(t: string): number | null {
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return h * 60 + Number(m[2]);
}

/** Minutes [start, end) of an event on `date`, or null if it isn't on that date. */
function eventSpan(e: Pick<CalEvent, "start" | "end">, date: string): [number, number] | null {
  const s = new Date(e.start);
  const en = new Date(e.end);
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${shiftDay(date, 1)}T00:00:00`);
  if (!Number.isFinite(s.getTime()) || !Number.isFinite(en.getTime()) || en <= s) throw new Error("Calendar contains an invalid event range.");
  if (s >= dayEnd || en <= dayStart) return null;
  return [s <= dayStart ? 0 : s.getHours() * 60 + s.getMinutes(), en >= dayEnd ? 1440 : en.getHours() * 60 + en.getMinutes()];
}

function subtract(free: [number, number][], busy: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of free) {
    if (busy[1] <= a || busy[0] >= b) out.push([a, b]);
    else {
      if (busy[0] > a) out.push([a, busy[0]]);
      if (busy[1] < b) out.push([busy[1], b]);
    }
  }
  return out;
}

/** Task ids that already have a block today or later — they're planned, not "unplanned". */
export function plannedTaskIds(events: CalEvent[], from: string): Set<number> {
  const ids = new Set<number>();
  for (const e of events) if (e.task_id != null && ymd(new Date(e.end)) >= from) ids.add(e.task_id);
  return ids;
}

/** Leaf tasks worth planning: not done, not parked in the backlog, not already on the calendar. */
export function plannableTasks(tasks: Task[], events: CalEvent[], from: string): Task[] {
  const planned = plannedTaskIds(events, from);
  const hasKids = new Set(tasks.filter((t) => t.parent_id != null).map((t) => t.parent_id!));
  return tasks.filter(
    (t) => t.status !== "done" && t.status !== "backlog" && !hasKids.has(t.id) && !planned.has(t.id),
  );
}

export interface Placement {
  task: Task;
  start: string; // local ISO without offset, e.g. 2026-09-27T09:00:00
  end: string;
}

/**
 * Greedy first-fit: highest priority first (then "doing" before "open", then nearest project
 * due date, then shortest). Leaves 15 minutes around each prayer and a 5-minute gap
 * between tasks. Returns what fit and what didn't — minutes never shrink.
 */
export function autoPlan(
  date: string,
  tasks: Task[],
  events: CalEvent[],
  windowsSpec: string,
  prayers: Prayers | null,
  projectDue: Map<number, string | null>,
  notBefore?: number,
): { placed: Placement[]; unplaced: Task[] } {
  let free = parseWindows(windowsSpec);
  if (notBefore !== undefined) free = subtract(free, [0, notBefore]);
  for (const e of events) {
    if (e.task_id == null && e.color === TEMPLATE_COLOR && isSlotTitle(e.title)) continue;
    const span = eventSpan(e, date);
    if (span) free = subtract(free, span);
  }
  if (prayers) {
    for (const t of Object.values(prayers)) {
      const m = prayerMin(t);
      if (m !== null) free = subtract(free, [m - 5, m + 15]);
    }
  }
  const due = (t: Task) => [t.due || "9999", (t.project_id != null && projectDue.get(t.project_id)) || "9999"].sort()[0];
  const queue = [...tasks].sort(
    (a, b) =>
      (a.priority ?? 2) - (b.priority ?? 2) ||
      Number(b.status === "doing") - Number(a.status === "doing") ||
      due(a).localeCompare(due(b)) ||
      a.est_min - b.est_min,
  );
  const placed: Placement[] = [];
  const unplaced: Task[] = [];
  for (const task of queue) {
    const need = Math.max(5, task.est_min || 25);
    const i = free.findIndex(([a, b]) => b - a >= need);
    if (i < 0) {
      unplaced.push(task);
      continue;
    }
    const [a] = free[i];
    placed.push({ task, start: `${date}T${fromMin(a)}:00`, end: `${date}T${fromMin(a + need)}:00` });
    free = subtract(free, [a, a + need + 5]);
  }
  return { placed, unplaced };
}
