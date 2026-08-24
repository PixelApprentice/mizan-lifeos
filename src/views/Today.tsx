import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  dayInfo,
  readTracker,
  upsertTrackerRow,
  todayStr,
  type DayInfo,
  type Prayers,
  type TrackerRow,
} from "../lib/api";
import { livePrayers } from "../lib/prayers";
import { listEvents, listTasks } from "../lib/data";
import { scoreRow } from "../lib/score";
import { shiftDay } from "../lib/plan";
import type { CalEvent, Task } from "../lib/api";
import { PixelBar } from "../components/Pixel";

interface Item {
  key: string;
  label: string;
  type: "bool" | "min" | "count";
  target?: (weekend: boolean) => number;
}

const ITEMS: Item[] = [
  { key: "fajr_on_time", label: "Fajr on time (before sunrise)", type: "bool" },
  { key: "prayers_5", label: "All five prayers on time", type: "bool" },
  { key: "sleep_on_time", label: "Sleep routine followed", type: "bool" },
  { key: "quran_min", label: "Quran minutes", type: "min", target: () => 60 },
  { key: "dsa_min", label: "DSA minutes", type: "min", target: (w) => (w ? 60 : 45) },
  { key: "dsa_problems", label: "DSA problems solved", type: "count" },
  { key: "build_min", label: "Build minutes", type: "min", target: (w) => (w ? 300 : 90) },
  { key: "consume_min", label: "Consume minutes (≤ ⅓ of build)", type: "min" },
  { key: "islamic_knowledge_min", label: "Islamic knowledge minutes", type: "min", target: (w) => (w ? 30 : 20) },
  { key: "movement", label: "Movement", type: "bool" },
  { key: "family_call", label: "Family check-in", type: "bool" },
  { key: "video", label: "Teaching video uploaded (one take)", type: "bool" },
  { key: "no_junk_spend", label: "Zero junk spending", type: "bool" },
  { key: "spend_birr", label: "Spending today (local currency)", type: "count" },
  { key: "urges_redirected", label: "Distractions redirected", type: "count" },
];

export default function Today() {
  const [info, setInfo] = useState<DayInfo | null>(null);
  const [prayers, setPrayers] = useState<Prayers | null>(null);
  const [source, setSource] = useState("");
  const [row, setRow] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [plan, setPlan] = useState<CalEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [trackerLoaded, setTrackerLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    dayInfo()
      .then(async (i) => {
        setInfo(i);
        const p = await livePrayers(i.prayers);
        setPrayers(p.prayers);
        setSource(p.source);
      })
      .catch((e) => setLoadErr(`Could not load the day: ${String(e)}`));
    readTracker()
      .then((rows: TrackerRow[]) => {
        const today = rows.find((r) => r.date === todayStr());
        if (today) setRow(today);
        setTrackerLoaded(true);
      })
      .catch((e) => setLoadErr(`Could not read your tracker: ${String(e)}`));
    const refresh = () => Promise.all([listEvents(), listTasks()])
      .then(([es, ts]) => {
        const start = new Date(`${todayStr()}T00:00:00`);
        const end = new Date(`${shiftDay(todayStr(), 1)}T00:00:00`);
        setPlan(es.filter((e) => new Date(e.start) < end && new Date(e.end) > start)
          .sort((a, b) => a.start.localeCompare(b.start)));
        setTasks(ts.filter((t) => t.status !== "done" && t.status !== "backlog")
          .sort((a, b) => a.priority - b.priority || (a.due ?? "9999").localeCompare(b.due ?? "9999")));
      })
      .catch((e) => setLoadErr(`Could not load the agenda: ${String(e)}`));
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("mizan:data-changed", refresh);
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("mizan:data-changed", refresh);
    };
  }, []);

  if (!info) return <p role={loadErr ? "alert" : "status"} className={loadErr ? "text-danger" : "text-ink-dim"}>{loadErr || "Loading today..."}</p>;
  const weekend = info.dow === "Saturday" || info.dow === "Sunday";
  const isFriday = info.dow === "Friday";
  const set = (key: string, value: string) => setRow((r) => ({ ...r, [key]: value }));

  const beforeStart = info.day < 1;
  const { score, failed } = scoreRow({ ...row, date: info.date });

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setSaveErr("");
    const fields: Record<string, string> = { day: String(info.day) };
    for (const it of ITEMS) fields[it.key] = row[it.key] ?? "";
    if (row.weight_kg) fields.weight_kg = row.weight_kg;
    if (row.shipped) fields.shipped = row.shipped;
    fields.score = String(score); // same rule as scripts/score.py, so stats work without --write
    try {
      await upsertTrackerRow(info.date, fields);
      setSaved(`saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
      window.dispatchEvent(new Event("mizan:tracker-saved"));
    } catch (e) {
      setSaved("");
      setSaveErr(`save failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const nowD = new Date(now);
  const current = plan.find((e) => new Date(e.start) <= nowD && nowD < new Date(e.end));
  const upcoming = plan.filter((e) => new Date(e.end) > nowD).slice(0, 6);
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <h2 className="cursor font-bold">
          {beforeStart ? "A fresh start" : `Day ${info.day}`}
        </h2>
        <p className="mt-1 text-sm text-ink-dim">
          {info.dow.toLowerCase()} · {info.date} ·{" "}
          {beforeStart ? (
            <>pre-start · day 1 = {info.day1}</>
          ) : (
            <>
              week {info.week} · your ongoing LifeOS
            </>
          )}
        </p>
      </header>
      {loadErr && <p role="alert" className="text-sm text-danger">{loadErr}</p>}

      {beforeStart && (
        <div className="panel flex flex-wrap items-center gap-4 border-gold/40 p-4">
          <span className="font-pixel text-xs text-gold">
            {info.day === 0 ? "day 1 starts tomorrow" : `day 1 starts in ${1 - info.day} days`}
          </span>
          <span className="text-sm text-ink-dim">
            {info.day1} · the counter is reset · tonight: plan day 1 so the morning has no decisions
          </span>
          <span className="ml-auto flex gap-2">
            <Link to="/log" className="btn-px bg-accent px-3 py-1.5 text-xs font-bold text-black">write day-1 plan</Link>
            <Link to="/planner" className="border border-edge px-3 py-1.5 text-xs text-ink-dim hover:text-ink">schedule day 1</Link>
          </span>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {/* ── left: the checklist ─────────────────────────── */}
        <details className="order-2 space-y-3">
          <summary className="hd">Daily routine · {score}/9 · expand to check in</summary>
          <PixelBar value={score} max={9} segments={9} color={score === 9 ? "var(--color-gold)" : "var(--color-accent)"} />
          <fieldset disabled={!trackerLoaded || busy || beforeStart} className="panel divide-y divide-edge/40 p-2">
            {ITEMS.map((it) => {
              const below = it.target && Number(row[it.key] ?? 0) < it.target(weekend);
              return (
                <div key={it.key} className="flex items-center justify-between gap-6 px-3 py-2.5">
                  <span className="text-sm">{it.label}</span>
                  {it.type === "bool" ? (
                    <button
                      aria-label={it.label}
                      aria-pressed={row[it.key] === "1"}
                      onClick={() => set(it.key, row[it.key] === "1" ? "0" : "1")}
                      className={`shrink-0 font-bold ${row[it.key] === "1" ? "text-accent" : "text-ink-faint hover:text-ink-dim"}`}
                    >
                      {row[it.key] === "1" ? "[✓]" : "[ ]"}
                    </button>
                  ) : (
                    <span className="flex shrink-0 items-center gap-2">
                      {it.target && (
                        <span className="text-[10px] text-ink-dim">/{it.target(weekend)}</span>
                      )}
                      <input
                        aria-label={it.label}
                        type="number"
                        min={0}
                        value={row[it.key] ?? ""}
                        onChange={(e) => set(it.key, e.target.value)}
                        className={`w-20 border bg-panel-2 px-2 py-1 text-right text-sm tabular-nums ${
                          below ? "border-danger/50" : "border-edge"
                        }`}
                      />
                    </span>
                  )}
                </div>
              );
            })}
            {isFriday && (
              <div className="flex items-center justify-between gap-6 px-3 py-2.5">
                <span className="text-sm text-gold">Friday weigh-in (kg)</span>
                <input
                  aria-label="Friday weigh-in in kilograms"
                  type="number"
                  step="0.1"
                  value={row.weight_kg ?? ""}
                  onChange={(e) => set("weight_kg", e.target.value)}
                  className="w-20 border border-edge bg-panel-2 px-2 py-1 text-right text-sm"
                />
              </div>
            )}
          </fieldset>
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={save}
              disabled={beforeStart || busy || !trackerLoaded}
              title={beforeStart ? "nothing before day 1 is tracked" : undefined}
              className="btn-px bg-accent px-5 py-2.5 text-sm font-bold text-black hover:opacity-90 disabled:opacity-30"
            >
              {busy ? "Saving..." : "Save check-in"}
            </button>
            <span role="status" className="text-xs text-accent">{saved}</span>
            {saveErr && <span role="alert" className="text-xs text-danger">{saveErr}</span>}
            {!saveErr && failed.length > 0 && !beforeStart && (
              <span className="text-[11px] text-ink-dim">missing: {failed.join(" · ")}</span>
            )}
          </div>
          <p className="text-xs text-ink-dim">Your check-in is saved locally. Writing a log is a separate action.</p>
        </details>

        {/* ── right: context ─────────────────────────────── */}
        <aside className="order-1 grid gap-6 xl:grid-cols-2">
          <div>
            <div className="hd">today's plan</div>
            <div className="panel mt-3 p-3 text-sm">
              {upcoming.length === 0 ? (
                <p className="px-1 py-1 text-xs text-ink-dim">
                  nothing scheduled ·{" "}
                  <Link to="/planner" className="text-accent hover:underline">
                    auto-plan today
                  </Link>
                </p>
              ) : (
                <ul className="space-y-1">
                  {upcoming.map((e) => (
                    <li key={e.id} className={`flex gap-3 px-1 ${current?.id === e.id ? "text-accent" : e.done ? "text-ink-dim line-through" : ""}`}>
                      <span className="w-16 shrink-0 text-[11px] tabular-nums text-ink-dim">{fmt(e.start)}</span>
                      <Link to="/planner" className="min-w-0 break-words hover:underline">{current?.id === e.id ? "Now: " : ""}{e.title}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-1.5 text-[10px] text-ink-dim">tomorrow: {shiftDay(info.date, 1)} · plan it in the planner</p>
          </div>

          <div>
            <div className="hd">Tasks to focus on</div>
            <div className="panel mt-3 divide-y divide-edge p-3 text-sm">
              {tasks.slice(0, 5).map((task) => <Link key={task.id} to="/tasks" className="flex flex-wrap items-center justify-between gap-2 py-2 hover:text-accent">
                <span className="min-w-0 break-words">{task.title}</span>
                <span className="text-xs text-ink-dim">{task.priority === 1 ? "Important · " : ""}{task.due ? `Due ${task.due.slice(0, 10)}` : "No deadline"}</span>
              </Link>)}
              {!tasks.length && <p className="py-2 text-ink-dim">No open tasks. <Link to="/tasks" className="text-accent">Add a task</Link></p>}
            </div>
            <Link to="/projects" className="mt-2 inline-block text-xs text-accent">Manage projects</Link>
          </div>

          <details>
            <summary className="hd">Prayer times {source === "live" ? "· live" : source === "cache" ? "· cached" : "· offline"}</summary>
            <div className="panel mt-3 divide-y divide-edge/40">
              {prayers &&
                Object.entries(prayers).map(([name, time]) => (
                  <div key={name} className="flex justify-between px-4 py-2 text-sm">
                    <span className="text-ink-dim">{name}</span>
                    <span className="tabular-nums">{time}</span>
                  </div>
                ))}
            </div>
            {source !== "live" && source !== "cache" && <p className="mt-2 text-xs text-ink-dim">Using local estimates when available. Set a location in Settings for live times.</p>}
          </details>

          <div>
            <div className="hd">log</div>
            <Link
              to="/log"
              className="panel mt-3 block w-full p-3 text-left text-sm text-ink-dim hover:text-ink"
            >
              ❯ write today's log
            </Link>
            <p className="mt-1.5 text-xs text-ink-dim">Plan ahead or reflect on the day. Your notes stay on this device.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
