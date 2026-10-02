// Reports: sprint burndown, velocity, weekly throughput, cycle time and workload.
import { useMemo } from "react";
import { STATUSES, memberName } from "../model";
import { burndown, cycleTime, statusCounts, throughput, velocity, workload } from "../reports";
import { Avatar, Empty, useWs } from "./ui";

function Line({ points, height = 140 }: { points: { label: string; a: number; b: number }[]; height?: number }) {
  const w = 560;
  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b].filter(Number.isFinite)));
  const x = (i: number) => (points.length < 2 ? 0 : (i / (points.length - 1)) * (w - 40) + 30);
  const y = (v: number) => height - 20 - (v / max) * (height - 30);
  const path = (k: "a" | "b") => points.map((p, i) => (Number.isFinite(p[k]) ? `${i === 0 || !Number.isFinite(points[i - 1][k]) ? "M" : "L"}${x(i)},${y(p[k])}` : "")).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label="Burndown chart: remaining work against the ideal line">
      <line x1="30" x2={w - 10} y1={height - 20} y2={height - 20} stroke="var(--color-edge)" />
      <text x="2" y="14" fontSize="10" fill="var(--color-ink-dim)">{max}</text>
      <path d={path("b")} fill="none" stroke="var(--color-ink-faint)" strokeDasharray="4 4" />
      <path d={path("a")} fill="none" stroke="var(--color-accent)" strokeWidth="2" />
      {points.map((p, i) => (i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 6) === 0) && <text key={i} x={x(i)} y={height - 5} fontSize="9" textAnchor="middle" fill="var(--color-ink-dim)">{p.label.slice(5)}</text>)}
    </svg>
  );
}

function Bars({ rows, unit }: { rows: { label: string; value: number; ghost?: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.ghost ?? 0)));
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate text-ink-dim">{r.label}</span>
          <span className="relative h-3 flex-1 bg-panel-2">
            {r.ghost !== undefined && <span className="absolute inset-y-0 left-0 bg-edge" style={{ width: `${(r.ghost / max) * 100}%` }} />}
            <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="w-16 text-right">{r.value}{r.ghost !== undefined ? ` / ${r.ghost}` : ""} {unit}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Reports() {
  const { model, project } = useWs();
  const issues = useMemo(() => model.issues.filter((i) => !project || i.project_id === project), [model, project]);
  const sprints = model.sprints.filter((s) => !project || s.project_id === project);
  const active = sprints.find((s) => s.state === "active");
  const burn = active ? burndown(active, issues) : [];
  const vel = velocity(sprints, issues).slice(-6);
  const thr = throughput(issues, 8);
  const cycle = cycleTime(issues);
  const load = workload(issues);
  const counts = statusCounts(issues);
  if (!issues.length) return <Empty>Reports appear once there are issues.</Empty>;
  const card = "border border-edge bg-panel p-4";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={`${card} lg:col-span-2`}>
        <h3 className="mb-2 font-bold">Status</h3>
        <div className="flex flex-wrap gap-4 text-sm">
          {STATUSES.map((s) => <span key={s.id}><span className="text-2xl font-digits text-accent">{counts[s.id] ?? 0}</span> <span className="text-ink-dim">{s.label}</span></span>)}
          <span><span className="text-2xl font-digits text-accent">{cycle ?? "–"}</span> <span className="text-ink-dim">median days to done (60 d)</span></span>
        </div>
      </section>
      <section className={card}>
        <h3 className="mb-1 font-bold">Burndown{active ? ` · ${active.name}` : ""}</h3>
        {burn.length ? <><Line points={burn.map((p) => ({ label: p.date, a: p.remaining, b: p.ideal }))} /><p className="text-xs text-ink-dim">Solid: remaining. Dashed: ideal pace.</p></> : <p className="text-sm text-ink-dim">Start a sprint with dates to see its burndown.</p>}
      </section>
      <section className={card}>
        <h3 className="mb-2 font-bold">Velocity</h3>
        {vel.length ? <Bars unit="" rows={vel.map((v) => ({ label: v.sprint, value: v.done, ghost: v.committed }))} /> : <p className="text-sm text-ink-dim">Complete a sprint to measure velocity (done / committed).</p>}
      </section>
      <section className={card}>
        <h3 className="mb-2 font-bold">Done per week</h3>
        <Bars unit="" rows={thr.map((t) => ({ label: `wk ${t.week.slice(5)}`, value: t.done }))} />
      </section>
      <section className={card}>
        <h3 className="mb-2 font-bold">Open work per person</h3>
        <ul className="space-y-1.5 text-sm">
          {load.map((l) => (
            <li key={l.assignee ?? "none"} className="flex items-center gap-2">
              <Avatar model={model} id={l.assignee} />
              <span className="flex-1">{memberName(model, l.assignee)}</span>
              <span className="text-ink-dim">{l.open} open · {l.estimate} est.</span>
              {l.overdue > 0 && <span className="text-danger">{l.overdue} overdue</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
