// Put one task on the calendar: pick a date/time, or take the next free slot the planner finds.
import { useEffect, useRef, useState } from "react";
import { Calendar } from "pixelarticons/react";
import { dayInfo, getSetting, todayStr, type Task } from "../lib/api";
import { addEvent, listEvents } from "../lib/data";
import { autoPlan, dayKind, DEFAULT_WINDOWS, KIND_COLORS, shiftDay } from "../lib/plan";
import { useDialogFocus } from "./useDialogFocus";

export async function windowsFor(date: string): Promise<string> {
  const kind = dayKind(date);
  return (await getSetting(`plan_windows_${kind}`)) || DEFAULT_WINDOWS[kind];
}

/** First free slot on `date` for this task (respecting prayers, blocks and work windows). */
export async function suggestSlot(task: Task, date: string): Promise<{ start: string; end: string } | null> {
  const [events, info, win] = await Promise.all([listEvents(), dayInfo(date), windowsFor(date)]);
  const now = new Date();
  const notBefore = date === todayStr() ? now.getHours() * 60 + now.getMinutes() : undefined;
  const { placed } = autoPlan(date, [task], events, win, info.prayers, new Map(), notBefore);
  return placed[0] ? { start: placed[0].start, end: placed[0].end } : null;
}

export default function ScheduleDialog({
  task,
  color,
  close,
  done,
}: {
  task: Task | null;
  color?: string;
  close: () => void;
  done: () => void;
}) {
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("20:30");
  const [mins, setMins] = useState(25);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const dialogRef = useDialogFocus(!!task);

  const suggest = async (d: string, t: Task) => {
    const version = ++request.current;
    setHint("finding a free slot…");
    setError("");
    let s;
    try { s = await suggestSlot(t, d); }
    catch (e) { if (version === request.current) { setError(String(e)); setHint(""); } return; }
    if (version !== request.current) return;
    if (s) {
      setTime(s.start.slice(11, 16));
      setHint(`next free slot on ${d}`);
    } else {
      setHint(`no free window left on ${d} — pick a time or try another day`);
    }
  };

  useEffect(() => {
    if (!task) return;
    setMins(task.est_min || 25);
    const now = new Date();
    // After 9 PM, today is over: suggest tomorrow.
    let alive = true;
    dayInfo().then((info) => {
      if (!alive) return;
      const d = todayStr() < info.day1 ? info.day1 : now.getHours() >= 21 ? shiftDay(todayStr(), 1) : todayStr();
      setDate(d);
      void suggest(d, task);
    }).catch((e) => setError(String(e)));
    return () => { alive = false; request.current++; };
  }, [task]);

  if (!task) return null;

  const save = async () => {
    setBusy(true); setError("");
    try {
    if (!Number.isInteger(mins) || mins < 5) throw new Error("Enter a whole number of at least 5 minutes.");
    const start = new Date(`${date}T${time}:00`);
    const end = new Date(start.getTime() + Math.max(5, mins) * 60000);
    await addEvent({
      title: task.title,
      start: start.toISOString(),
      end: end.toISOString(),
      task_id: task.id,
      color: color ?? KIND_COLORS[task.kind] ?? KIND_COLORS.other,
    });
    done();
    close();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75" onClick={() => { if (!busy) close(); }}>
      <div
        className="panel w-[min(440px,92vw)] space-y-4 bg-panel p-5"
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        aria-label="Schedule task"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) close();
        }}
      >
        <div className="hd">schedule</div>
        <p className="text-sm">{task.title}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            aria-label="Task schedule date"
            autoFocus
            disabled={busy}
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              if (e.target.value) suggest(e.target.value, task);
            }}
            className="border border-edge bg-panel-2 px-2 py-1.5 outline-none focus:border-accent"
          />
          <input
            aria-label="Task schedule time"
            disabled={busy}
            type="time"
            value={time}
            onChange={(e) => { request.current++; setTime(e.target.value); }}
            className="border border-edge bg-panel-2 px-2 py-1.5 tabular-nums outline-none focus:border-accent"
          />
          <input
            aria-label="Task scheduled minutes"
            disabled={busy}
            type="number"
            min={5}
            value={mins}
            onChange={(e) => setMins(Number(e.target.value))}
            className="w-16 border border-edge bg-panel-2 px-2 py-1.5 text-right tabular-nums outline-none focus:border-accent"
            title="minutes"
          />
          <span className="text-xs text-ink-dim">min</span>
        </div>
        <p className="text-[11px] text-ink-dim">{hint}</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button disabled={busy} onClick={close} className="border border-edge px-4 py-1.5 text-xs text-ink-dim">
            cancel
          </button>
          <button disabled={busy} onClick={save} className="btn-px flex items-center gap-2 bg-accent px-4 py-1.5 text-xs font-bold text-black">
            <Calendar className="px-icon h-3.5 w-3.5" /> {busy ? "Saving..." : "Put on calendar"}
          </button>
        </div>
      </div>
    </div>
  );
}
