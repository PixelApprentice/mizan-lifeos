import { useCallback, useEffect, useMemo, useState } from "react";
import { readSessions, readTracker, todayStr, type SessionRecord, type Task, type TrackerRow } from "../lib/api";
import { listTasks } from "../lib/data";
import { currentStreak } from "../lib/score";
import { maxScore } from "../lib/routine";
import { useRoutine } from "../lib/useRoutine";
import { lastDays, summarizeStats } from "../lib/stats";

// Chart colors: validated categorical dark-mode slots (dataviz reference palette)
// against this app's chart surface #0a0a0c — all six checks pass.
const S1 = "#3987e5"; // slot 1 blue — build / primary series
const S2 = "#d95926"; // slot 2 orange — consume
const GRID = "var(--chart-grid)";
const MUTED = "var(--chart-muted)";

const n = (v?: string) => (v && v !== "" ? Number(v) : 0);

interface Tip {
  x: number;
  y: number;
  text: string;
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 border border-edge bg-panel-2 px-2 py-1 text-xs text-ink"
      style={{ left: tip.x + 10, top: tip.y - 10 }}
    >
      {tip.text}
    </div>
  );
}

/** Bar chart: one or two series, square pixel bars, 2px gaps, hover tooltip. */
function Bars({
  data,
  series,
  max,
  height = 140,
  refLine,
}: {
  data: { label: string; a: number; b?: number }[];
  series: { name: string; color: string }[];
  max: number;
  height?: number;
  refLine?: number;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  max = Math.max(1, max);
  const W = 640;
  const padL = 28;
  const plotW = W - padL - 4;
  const group = plotW / Math.max(1, data.length);
  const two = series.length === 2;
  const barW = Math.max(3, (two ? group / 2 : group) - 2);
  const y = (v: number) => height - 18 - (Math.min(v, max) / max) * (height - 26);

  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full">
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W - 4} y1={y(max * f)} y2={y(max * f)} style={{ stroke: GRID }} strokeWidth="1" />
            <text x={padL - 4} y={y(max * f) + 3} textAnchor="end" fontSize="9" style={{ fill: MUTED }}>
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        <line x1={padL} x2={W - 4} y1={y(0)} y2={y(0)} style={{ stroke: "var(--chart-axis)" }} strokeWidth="1" />
        {refLine !== undefined && (
          <line
            x1={padL}
            x2={W - 4}
            y1={y(refLine)}
            y2={y(refLine)}
            style={{ stroke: MUTED }}
            strokeWidth="1"
            strokeDasharray="4 3"
          />
        )}
        {data.map((d, i) => {
          const x0 = padL + i * group + 1;
          return (
            <g key={d.label}>
              <rect
                x={x0}
                y={y(d.a)}
                width={barW}
                height={Math.max(0, y(0) - y(d.a))}
                rx="0"
                fill={series[0].color}
                onMouseMove={(e) =>
                  setTip({
                    x: e.nativeEvent.offsetX,
                    y: e.nativeEvent.offsetY,
                    text: `${d.label} · ${series[0].name}: ${d.a}${two ? ` · ${series[1].name}: ${d.b ?? 0}` : ""}`,
                  })
                }
              />
              {two && (
                <rect
                  x={x0 + barW + 2}
                  y={y(d.b ?? 0)}
                  width={barW}
                  height={Math.max(0, y(0) - y(d.b ?? 0))}
                  rx="0"
                  fill={series[1].color}
                  onMouseMove={(e) =>
                    setTip({
                      x: e.nativeEvent.offsetX,
                      y: e.nativeEvent.offsetY,
                      text: `${d.label} · ${series[1].name}: ${d.b ?? 0}`,
                    })
                  }
                />
              )}
              {data.length <= 31 && i % Math.ceil(data.length / 8) === 0 && (
                <text x={x0 + barW / 2} y={height - 6} textAnchor="middle" fontSize="8" style={{ fill: MUTED }}>
                  {d.label.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
      {series.length >= 2 && (
        <div className="mt-1 flex gap-4 text-xs text-ink-dim">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Single-series line with point markers and nearest-point hover tooltip. */
function LineChart({ points, height = 120, unit }: { points: { label: string; v: number }[]; height?: number; unit: string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const W = 640;
  const padL = 34;
  if (points.length === 0) return <p className="text-xs text-ink-dim">No data yet.</p>;
  const vals = points.map((p) => p.v);
  const lo = Math.min(...vals) - 0.5;
  const hi = Math.max(...vals) + 0.5;
  const x = (i: number) => padL + (i / Math.max(1, points.length - 1)) * (W - padL - 8);
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo)) * (height - 30);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.v)}`).join(" ");

  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        onMouseMove={(e) => {
          const rect = (e.target as SVGElement).closest("svg")!.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
          setTip({
            x: e.nativeEvent.offsetX,
            y: e.nativeEvent.offsetY,
            text: `${points[best].label}: ${points[best].v} ${unit}`,
          });
        }}
      >
        {[lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.75].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - 8} y1={y(v)} y2={y(v)} style={{ stroke: GRID }} strokeWidth="1" />
            <text x={padL - 4} y={y(v) + 3} textAnchor="end" fontSize="9" style={{ fill: MUTED }}>
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke={S1} strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.label} cx={x(i)} cy={y(p.v)} r="4" fill={S1} style={{ stroke: "var(--color-panel)" }} strokeWidth="2" />
        ))}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel p-4">
      <div className="text-xs uppercase tracking-wider text-ink-dim">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-ink-dim">{sub}</div>}
    </div>
  );
}

const hours = (min: number) => min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
const when = (stamp: string) => {
  const date = new Date(stamp);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : stamp;
};

export default function Stats() {
  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [range, setRange] = useState<7 | 28>(28);
  const [showTable, setShowTable] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const routine = useRoutine();

  const load = useCallback(async () => {
    const results = await Promise.allSettled([readSessions(), listTasks(), readTracker()]);
    const problems: string[] = [];
    if (results[0].status === "fulfilled") setSessions(results[0].value); else problems.push(`Focus history: ${results[0].reason}`);
    if (results[1].status === "fulfilled") setTasks(results[1].value); else problems.push(`Tasks: ${results[1].reason}`);
    if (results[2].status === "fulfilled") setRows([...results[2].value].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")));
    else problems.push(`Daily check-ins (tracker.csv): ${results[2].reason}`);
    setErrors(problems);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    for (const name of ["focus", "mizan:data-changed", "mizan:focus-changed"]) window.addEventListener(name, refresh);
    return () => { for (const name of ["focus", "mizan:data-changed", "mizan:focus-changed"]) window.removeEventListener(name, refresh); };
  }, [load]);

  const today = todayStr();
  const summary = useMemo(() => summarizeStats(sessions, tasks, today), [sessions, tasks, today]);
  const days = lastDays(today, range);
  const focusBars = days.map((day) => ({ label: day, a: summary.focus.get(day)?.minutes ?? 0 }));
  const doneBars = days.map((day) => ({ label: day, a: summary.done.get(day) ?? 0 }));
  const recent = [...sessions].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 8);

  const tracked = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date ?? ""));
  const last28 = tracked.slice(-28);
  const max = routine ? maxScore(routine) : 9;
  const passed = tracked.filter((r) => max > 0 && n(r.score) >= max).length;
  const streakItem = routine?.items.find((i) => i.type === "bool" && i.scored);
  const columns = (routine?.items ?? []).filter((i) => i.type !== "bool").slice(0, 8);
  const hasBuild = !!routine?.items.some((i) => i.key === "build_min") && !!routine?.items.some((i) => i.key === "consume_min");
  const short = (label: string) => label.replace(/\s*\(.*\)\s*/g, "").replace(/ minutes$/i, "").toLowerCase().slice(0, 14);
  const weights = tracked.filter((r) => r.weight_kg && r.weight_kg !== "").map((r) => ({ label: r.date, v: n(r.weight_kg) }));
  const totalBuild = tracked.reduce((s, r) => s + n(r.build_min), 0);
  const totalConsume = tracked.reduce((s, r) => s + n(r.consume_min), 0);
  const ratio = totalBuild ? totalConsume / totalBuild : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="cursor font-bold">Stats</h2>
        <div className="flex border border-edge text-xs" role="group" aria-label="Chart range">
          {([7, 28] as const).map((value) => <button key={value} aria-pressed={range === value} onClick={() => setRange(value)} className={`px-3 py-1.5 ${range === value ? "bg-panel-2 text-ink" : "text-ink-dim"}`}>{value} days</button>)}
        </div>
      </div>
      {errors.map((problem) => <p key={problem} role="alert" className="text-sm text-danger">{problem}</p>)}
      {loading && <p role="status" className="text-sm text-ink-dim">Loading stats...</p>}

      <section className="space-y-3" aria-labelledby="focus-stats">
        <h3 id="focus-stats" className="hd">Focus</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="This week" value={hours(summary.focusWeekMin)} sub={`${hours(summary.focusTotalMin)} all time`} />
          <Tile label="Sessions finished" value={`${summary.finished}/${summary.sessions}`} sub={summary.completionRate === null ? "none yet" : `${summary.completionRate}% finished`} />
          <Tile label="Focus streak" value={String(summary.focusStreak)} sub="days in a row" />
          <Tile label="Average session" value={hours(summary.averageMin)} sub={summary.phoneChecks ? `${summary.phoneChecks} phone checks` : "finished sessions"} />
        </div>
        <div className="panel p-5">
          <div className="hd mb-4">focus minutes · last {range} days</div>
          {summary.sessions ? <Bars data={focusBars} series={[{ name: "focus min", color: S1 }]} max={Math.max(60, ...focusBars.map((d) => d.a))} />
            : <p className="text-sm text-ink-dim">No focus sessions yet. Start one from Focus and it will show here.</p>}
        </div>
        {recent.length > 0 && <div className="panel p-5">
          <div className="hd mb-3">recent sessions</div>
          <ul className="divide-y divide-edge/50 text-sm">
            {recent.map((s) => <li key={s.started_at} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span>{when(s.started_at)}</span>
              <span className={s.broken ? "text-danger" : "text-accent"}>{s.actual_min}/{s.planned_min} min{s.broken ? " · ended early" : " · finished"}</span>
              {s.broken && s.reason && <span className="w-full text-xs text-ink-dim">Reason: {s.reason}</span>}
            </li>)}
          </ul>
        </div>}
      </section>

      <section className="space-y-3" aria-labelledby="task-stats">
        <h3 id="task-stats" className="hd">Tasks</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Done this week" value={String(summary.doneWeek)} sub={`${summary.doneTotal} all time`} />
          <Tile label="Open" value={String(summary.open)} sub={`${summary.doing} in progress`} />
          <Tile label="Overdue" value={String(summary.overdue)} sub={summary.overdue ? "reschedule or drop" : "on track"} />
          <Tile label="Completion streak" value={String(summary.taskStreak)} sub="days in a row" />
        </div>
        <div className="panel p-5">
          <div className="hd mb-4">tasks completed · last {range} days</div>
          {summary.doneTotal ? <Bars data={doneBars} series={[{ name: "tasks done", color: S2 }]} max={Math.max(4, ...doneBars.map((d) => d.a))} />
            : <p className="text-sm text-ink-dim">No completed tasks yet. Tick a task when it is done and it will show here.</p>}
          {summary.byKind.length > 0 && <p className="mt-3 text-xs text-ink-dim">By category: {summary.byKind.map(([kind, count]) => `${kind} ${count}`).join(" · ")}</p>}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="checkin-stats">
        <div className="flex items-center justify-between">
          <h3 id="checkin-stats" className="hd">Daily check-ins</h3>
          {tracked.length > 0 && <button onClick={() => setShowTable(!showTable)} className="border border-edge px-3 py-1.5 text-xs text-ink-dim hover:bg-panel-2">{showTable ? "Charts" : "Table view"}</button>}
        </div>
        {!tracked.length ? <p className="panel p-5 text-sm text-ink-dim">No check-ins yet. Fill in the evening check-in on Today and your scores and streaks will show here. Shape the routine in Settings → Daily routine.</p> : <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Days logged" value={String(tracked.length)} sub="all time" />
            <Tile label={`Perfect days ${max}/${max}`} value={String(passed)} />
            <Tile label="Perfect streak" value={String(currentStreak(tracked, (r) => max > 0 && n(r.score) >= max, today))} sub="days" />
            {streakItem && <Tile label={`${short(streakItem.label)} streak`} value={String(currentStreak(tracked, (r) => n(r[streakItem.key]) === 1, today))} sub="days" />}
          </div>
          {routine?.scoring === "classic" && ratio > 1 / 3 && <p className="border border-danger/40 bg-danger/10 p-3 text-sm text-danger">Overall consume:build ratio is {ratio.toFixed(2)}, above the ⅓ limit.</p>}
          {showTable ? (
            <div className="panel overflow-x-auto">
              <table className="w-full text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
                <thead className="bg-panel text-ink-dim"><tr>{["date", "score", ...columns.map((c) => short(c.label))].map((h, i) => <th key={`${h}-${i}`} className="px-2 py-1.5 text-left font-normal">{h}</th>)}</tr></thead>
                <tbody>{tracked.map((r) => <tr key={r.date} className="border-t border-edge/50">
                  <td className="px-2 py-1">{r.date}</td>
                  <td className={`px-2 py-1 ${max > 0 && n(r.score) >= max ? "text-accent" : "text-danger"}`}>{r.score || "—"}</td>
                  {columns.map((c) => <td key={c.key} className="px-2 py-1">{r[c.key]}</td>)}
                </tr>)}</tbody>
              </table>
            </div>
          ) : <>
            <div className="panel p-5"><div className="hd mb-4">daily score · last 28 check-ins · /{max}</div>
              <Bars data={last28.map((r) => ({ label: r.date, a: n(r.score) }))} series={[{ name: "score", color: S1 }]} max={Math.max(1, max, ...last28.map((r) => n(r.score)))} /></div>
            {hasBuild && <div className="panel p-5"><div className="hd mb-4">build vs consume minutes</div>
              <Bars data={last28.map((r) => ({ label: r.date, a: n(r.build_min), b: n(r.consume_min) }))} series={[{ name: "build", color: S1 }, { name: "consume", color: S2 }]} max={Math.max(120, ...last28.map((r) => Math.max(n(r.build_min), n(r.consume_min))))} /></div>}
            {weights.length > 0 && <div className="panel p-5"><div className="hd mb-4">weight · kg</div><LineChart points={weights} unit="kg" /></div>}
          </>}
        </>}
      </section>
    </div>
  );
}
