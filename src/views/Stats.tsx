import { useEffect, useMemo, useState } from "react";
import { readSessions, readTracker, todayStr, type SessionRecord, type TrackerRow } from "../lib/api";
import { currentStreak } from "../lib/score";

// Chart colors: validated categorical dark-mode slots (dataviz reference palette)
// against this app's chart surface #0a0a0c — all six checks pass.
const S1 = "#3987e5"; // slot 1 blue — build / primary series
const S2 = "#d95926"; // slot 2 orange — consume
const GRID = "#2c2c2a";
const MUTED = "#898781";

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
            <line x1={padL} x2={W - 4} y1={y(max * f)} y2={y(max * f)} stroke={GRID} strokeWidth="1" />
            <text x={padL - 4} y={y(max * f) + 3} textAnchor="end" fontSize="9" fill={MUTED}>
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        <line x1={padL} x2={W - 4} y1={y(0)} y2={y(0)} stroke="#383835" strokeWidth="1" />
        {refLine !== undefined && (
          <line
            x1={padL}
            x2={W - 4}
            y1={y(refLine)}
            y2={y(refLine)}
            stroke={MUTED}
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
                <text x={x0 + barW / 2} y={height - 6} textAnchor="middle" fontSize="8" fill={MUTED}>
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
            <line x1={padL} x2={W - 8} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth="1" />
            <text x={padL - 4} y={y(v) + 3} textAnchor="end" fontSize="9" fill={MUTED}>
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke={S1} strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.label} cx={x(i)} cy={y(p.v)} r="4" fill={S1} stroke="#0a0a0c" strokeWidth="2" />
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

export default function Stats() {
  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [showTable, setShowTable] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    readTracker().then((r) => setRows(r.sort((a, b) => a.date.localeCompare(b.date)))).catch((e) => setError(String(e)));
    readSessions().then(setSessions).catch((e) => setError(String(e)));
  }, []);

  const last28 = rows.slice(-28);
  const passed = rows.filter((r) => n(r.score) === 9).length;
  const dsaTotal = rows.reduce((s, r) => s + n(r.dsa_problems), 0);
  const broken = sessions.filter((s) => s.broken).length;
  const weights = useMemo(
    () => rows.filter((r) => r.weight_kg && r.weight_kg !== "").map((r) => ({ label: r.date, v: n(r.weight_kg) })),
    [rows],
  );
  const totalBuild = rows.reduce((s, r) => s + n(r.build_min), 0);
  const totalConsume = rows.reduce((s, r) => s + n(r.consume_min), 0);
  const ratio = totalBuild ? totalConsume / totalBuild : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="cursor font-bold">stats</h2>
        <button
          onClick={() => setShowTable(!showTable)}
          className="border border-edge px-3 py-1.5 text-xs text-ink-dim hover:bg-panel-2"
        >
          {showTable ? "Charts" : "Table view"}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Days logged" value={String(rows.length)} sub="all time" />
        <Tile label="Passed 9/9" value={String(passed)} />
        <Tile label="Perfect streak" value={String(currentStreak(rows, (r) => n(r.score) === 9, todayStr()))} sub="days" />
        <Tile label="Fajr streak" value={String(currentStreak(rows, (r) => n(r.fajr_on_time) === 1, todayStr()))} sub="days" />
        <Tile label="DSA solved" value={String(dsaTotal)} sub="all time" />
        <Tile label="Broken sessions" value={String(broken)} sub={broken > 0 ? "explain on Friday" : "clean"} />
      </div>

      {ratio > 1 / 3 && rows.length > 0 && (
        <p className="border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          Overall consume:build ratio {ratio.toFixed(2)} — above the ⅓ limit. TUTORIAL HELL.
        </p>
      )}

      {showTable ? (
        <div className="panel overflow-x-auto">
          <table className="w-full text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead className="bg-panel text-ink-dim">
              <tr>
                {["date", "score", "quran", "dsa", "probs", "build", "consume", "video", "spent", "kg"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="border-t border-edge/50">
                  <td className="px-2 py-1">{r.date}</td>
                  <td className={`px-2 py-1 ${n(r.score) === 9 ? "text-accent" : "text-danger"}`}>{r.score || "—"}</td>
                  <td className="px-2 py-1">{r.quran_min}</td>
                  <td className="px-2 py-1">{r.dsa_min}</td>
                  <td className="px-2 py-1">{r.dsa_problems}</td>
                  <td className="px-2 py-1">{r.build_min}</td>
                  <td className="px-2 py-1">{r.consume_min}</td>
                  <td className="px-2 py-1">{r.video}</td>
                  <td className="px-2 py-1">{r.spend_birr}</td>
                  <td className="px-2 py-1">{r.weight_kg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <section className="panel p-5">
            <div className="hd mb-4">daily score · last 28 days · /9</div>
            <Bars
              data={last28.map((r) => ({ label: r.date, a: n(r.score) }))}
              series={[{ name: "score", color: S1 }]}
              max={9}
            />
          </section>

          <section className="panel p-5">
            <div className="hd mb-4">build vs consume minutes</div>
            <Bars
              data={last28.map((r) => ({ label: r.date, a: n(r.build_min), b: n(r.consume_min) }))}
              series={[
                { name: "build", color: S1 },
                { name: "consume", color: S2 },
              ]}
              max={Math.max(120, ...last28.map((r) => n(r.build_min)))}
            />
          </section>

          <section className="panel p-5">
            <div className="hd mb-4">weight · friday weigh-ins · kg</div>
            <LineChart points={weights} unit="kg" />
          </section>
        </>
      )}
    </div>
  );
}
