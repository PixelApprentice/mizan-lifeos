// Team reports computed from merged rows: sprint burndown, velocity, weekly throughput,
// cycle time and open workload per person. Pure functions so they are easy to test.
import type { Issue, Sprint } from "./model.ts";
import { isClosed } from "./model.ts";

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const points = (i: Issue) => (typeof i.estimate === "number" ? i.estimate : 0);

export interface BurnPoint { date: string; remaining: number; ideal: number }

/** Remaining estimate per day of a sprint (scope = issues currently in it). Counts issues if nothing is estimated. */
export function burndown(sprint: Sprint, issues: readonly Issue[], today = new Date()): BurnPoint[] {
  if (!sprint.start || !sprint.end) return [];
  const start = new Date(`${sprint.start.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${sprint.end.slice(0, 10)}T00:00:00Z`);
  if (!(end >= start)) return [];
  const scope = issues.filter((i) => i.sprint_id === sprint.id && i.status !== "canceled");
  const usePoints = scope.some((i) => points(i) > 0);
  const weight = (i: Issue) => (usePoints ? points(i) : 1);
  const total = scope.reduce((s, i) => s + weight(i), 0);
  const days = Math.round((end.getTime() - start.getTime()) / DAY);
  const stop = Math.min(end.getTime(), new Date(`${dayKey(today)}T00:00:00Z`).getTime());
  const out: BurnPoint[] = [];
  for (let k = 0; k <= days; k++) {
    const t = start.getTime() + k * DAY;
    const date = dayKey(new Date(t));
    const ideal = days === 0 ? 0 : +(total * (1 - k / days)).toFixed(2);
    const doneBy = scope.filter((i) => i.status === "done" && i.resolved_at && i.resolved_at.slice(0, 10) <= date);
    const remaining = t <= stop ? total - doneBy.reduce((s, i) => s + weight(i), 0) : NaN;
    out.push({ date, remaining, ideal });
  }
  return out;
}

/** Completed estimate (or issue count) for each closed sprint, oldest first. */
export function velocity(sprints: readonly Sprint[], issues: readonly Issue[]): { sprint: string; done: number; committed: number }[] {
  return sprints
    .filter((s) => s.state === "closed")
    .map((s) => {
      const scope = issues.filter((i) => i.sprint_id === s.id && i.status !== "canceled");
      const usePoints = scope.some((i) => points(i) > 0);
      const w = (i: Issue) => (usePoints ? points(i) : 1);
      return { sprint: s.name, done: scope.filter((i) => i.status === "done").reduce((a, i) => a + w(i), 0), committed: scope.reduce((a, i) => a + w(i), 0) };
    });
}

/** Monday of the week containing `d`, as YYYY-MM-DD (UTC). */
export function weekOf(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7;
  return dayKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)));
}

/** Issues finished per week for the last `weeks` weeks. */
export function throughput(issues: readonly Issue[], weeks = 8, today = new Date()): { week: string; done: number }[] {
  const out: { week: string; done: number }[] = [];
  const thisWeek = new Date(`${weekOf(today)}T00:00:00Z`).getTime();
  for (let k = weeks - 1; k >= 0; k--) out.push({ week: dayKey(new Date(thisWeek - k * 7 * DAY)), done: 0 });
  for (const i of issues) {
    if (i.status !== "done" || !i.resolved_at) continue;
    const w = weekOf(new Date(i.resolved_at));
    const slot = out.find((x) => x.week === w);
    if (slot) slot.done++;
  }
  return out;
}

/** Median days from creation to done, over issues finished in the last `days` days. */
export function cycleTime(issues: readonly Issue[], days = 60, today = new Date()): number | null {
  const since = today.getTime() - days * DAY;
  const spans = issues
    .filter((i) => i.status === "done" && i.resolved_at && i.created_at && new Date(i.resolved_at).getTime() >= since)
    .map((i) => (new Date(i.resolved_at!).getTime() - new Date(i.created_at).getTime()) / DAY)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  if (!spans.length) return null;
  const mid = Math.floor(spans.length / 2);
  return +(spans.length % 2 ? spans[mid] : (spans[mid - 1] + spans[mid]) / 2).toFixed(1);
}

/** Open issues and estimate per assignee (null = unassigned), busiest first. */
export function workload(issues: readonly Issue[]): { assignee: string | null; open: number; estimate: number; overdue: number }[] {
  const today = dayKey(new Date());
  const map = new Map<string | null, { assignee: string | null; open: number; estimate: number; overdue: number }>();
  for (const i of issues) {
    if (isClosed(i.status)) continue;
    const row = map.get(i.assignee) ?? { assignee: i.assignee, open: 0, estimate: 0, overdue: 0 };
    row.open++;
    row.estimate += points(i);
    if (i.due && i.due.slice(0, 10) < today) row.overdue++;
    map.set(i.assignee, row);
  }
  return [...map.values()].sort((a, b) => b.open - a.open);
}

/** Count of issues per status for a set. */
export function statusCounts(issues: readonly Issue[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of issues) out[i.status] = (out[i.status] ?? 0) + 1;
  return out;
}
