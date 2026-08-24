// Planner: the calendar. Drag tasks onto time slots, seed a day from the template, or let
// auto-plan fit every open task into the day's free work windows — around prayers and
// whatever is already booked. Blocks move; minutes don't shrink.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/interaction";
import type { EventClickArg, EventDropArg, EventInput } from "@fullcalendar/core";
import { MagicEdit, Calendar as CalIcon, Trash } from "pixelarticons/react";
import { dayInfo, getSetting, todayStr, type CalEvent, type DayInfo, type Project, type Task } from "../lib/api";
import { addEvent, deleteEvent, listEvents, listProjects, listTasks, updateEvent, updateTask } from "../lib/data";
import {
  autoPlan,
  dayKind,
  DEFAULT_WINDOWS,
  hm,
  isSlotTitle,
  KIND_COLORS,
  plannableTasks,
  shiftDay,
  TEMPLATE_COLOR,
  TEMPLATES,
  ymd,
} from "../lib/plan";
import Modal, { type ModalRequest } from "../components/Modal";
import { useDialogFocus } from "../components/useDialogFocus";

interface EventEdit {
  id: number | null;
  title: string;
  date: string;
  start: string;
  end: string;
  endDate: string;
  taskId: number | null;
  done: boolean;
}

// Default planning date: today, tomorrow once the evening is over, or day 1 before the start.
function defaultPlanDate(info: DayInfo | null): string {
  const t = todayStr();
  if (info && t < info.day1) return info.day1;
  return new Date().getHours() >= 21 ? shiftDay(t, 1) : t;
}

export default function Planner() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [info, setInfo] = useState<DayInfo | null>(null);
  const [planDate, setPlanDate] = useState(todayStr());
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [msg, setMsg] = useState("");
  const [modal, setModal] = useState<ModalRequest | null>(null);
  const [edit, setEdit] = useState<EventEdit | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [agenda, setAgenda] = useState(false);
  const dialogRef = useDialogFocus(!!edit);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const calRef = useRef<FullCalendar>(null);

  const load = useCallback(async () => {
    const [e, t, p] = await Promise.all([listEvents(), listTasks(), listProjects()]);
    setEvents(e);
    setTasks(t);
    setProjects(p);
  }, []);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const refresh = () => { void load().catch((e) => setError(String(e))); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("mizan:data-changed", refresh);
    dayInfo()
      .then((i) => {
        setInfo(i);
        const d = defaultPlanDate(i);
        setPlanDate(d);
        calRef.current?.getApi().gotoDate(d);
      })
      .catch((e) => setError(String(e)));
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("mizan:data-changed", refresh); };
  }, [load]);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const colorOf = (t: Task) => (t.project_id != null && projectById.get(t.project_id)?.color) || KIND_COLORS[t.kind] || KIND_COLORS.other;

  const unplanned = useMemo(() => {
    const list = plannableTasks(tasks, events, todayStr());
    if (projectFilter === "all") return list;
    if (projectFilter === "none") return list.filter((t) => t.project_id == null);
    return list.filter((t) => String(t.project_id) === projectFilter);
  }, [tasks, events, projectFilter]);

  useEffect(() => {
    if (!sidebarRef.current) return;
    const d = new Draggable(sidebarRef.current, {
      itemSelector: "[data-task]",
      eventData: (el) => ({
        title: el.getAttribute("data-title") ?? "task",
        duration: { minutes: Number(el.getAttribute("data-est") ?? 25) },
        extendedProps: { taskId: Number(el.getAttribute("data-task")) },
        color: el.getAttribute("data-color") ?? undefined,
      }),
    });
    return () => d.destroy();
  }, [unplanned.length]);

  const moveEvent = async (arg: { event: EventDropArg["event"]; revert: () => void }) => {
    const e = arg.event;
    try {
      await updateEvent(Number(e.id), { start: e.start!.toISOString(), end: (e.end ?? e.start)!.toISOString() });
      await load();
    } catch (error) { arg.revert(); setError(String(error)); }
  };

  const clickEvent = (arg: EventClickArg) => {
    if (arg.event.display === "background") return;
    const s = arg.event.start!;
    const e = arg.event.end ?? s;
    const ev = events.find((x) => x.id === Number(arg.event.id));
    setEdit({
      id: Number(arg.event.id),
      title: ev?.title ?? arg.event.title,
      date: ymd(s),
      start: hm(s),
      end: hm(e),
      endDate: ymd(e),
      taskId: ev?.task_id ?? null,
      done: !!ev?.done,
    });
  };

  const saveEdit = async () => {
    if (!edit) return;
    const patch = {
      title: edit.title.trim(),
      start: new Date(`${edit.date}T${edit.start}:00`).toISOString(),
      end: new Date(`${edit.endDate}T${edit.end}:00`).toISOString(),
    };
    if (edit.id === null) await addEvent(patch);
    else await updateEvent(edit.id, patch);
    setEdit(null);
    await load();
  };

  const toggleDone = async () => {
    if (!edit || edit.id === null) return;
    const done = !edit.done;
    await updateEvent(edit.id, { done: done ? 1 : 0 });
    if (edit.taskId != null) await updateTask(edit.taskId, { status: done ? "done" : "open" });
    setEdit(null);
    load();
  };

  const removeEdit = async () => {
    if (!edit || edit.id === null) return;
    await deleteEvent(edit.id);
    setEdit(null);
    load();
  };

  const seedTemplate = async () => {
    const kind = dayKind(planDate);
    const onDay = await listEvents();
    const run = async () => {
      for (const [s, e, title] of TEMPLATES[kind]) {
        const start = new Date(`${planDate}T${s}:00`).toISOString();
        const end = new Date(`${planDate}T${e}:00`).toISOString();
        if (onDay.some((existing) => existing.title === title && existing.start === start && existing.end === end)) continue;
        await addEvent({
          title,
          start,
          end,
          color: TEMPLATE_COLOR,
        });
      }
      setMsg(`${kind} template placed on ${planDate}`);
      calRef.current?.getApi().gotoDate(planDate);
      await load();
    };
    await run();
  };

  const runAutoPlan = async () => {
    const [evs, all, ps, di] = await Promise.all([listEvents(), listTasks(), listProjects(), dayInfo(planDate)]);
    const kind = dayKind(planDate);
    const win = (await getSetting(`plan_windows_${kind}`)) || DEFAULT_WINDOWS[kind];
    const now = new Date();
    const notBefore = planDate === todayStr() ? now.getHours() * 60 + now.getMinutes() : undefined;
    const candidates = plannableTasks(all, evs, todayStr()).filter(
      (t) => projectFilter === "all" || (projectFilter === "none" ? t.project_id == null : String(t.project_id) === projectFilter),
    );
    if (!candidates.length) {
      setMsg("nothing to plan — every open task already has a block (or add tasks first)");
      return;
    }
    const due = new Map(ps.map((p) => [p.id, p.due]));
    const { placed, unplaced } = autoPlan(planDate, candidates, evs, win, di.prayers, due, notBefore);
    const pById = new Map(ps.map((p) => [p.id, p]));
    for (const p of placed) {
      const c = (p.task.project_id != null && pById.get(p.task.project_id)?.color) || KIND_COLORS[p.task.kind] || KIND_COLORS.other;
      await addEvent({
        title: p.task.title,
        start: new Date(p.start).toISOString(),
        end: new Date(p.end).toISOString(),
        task_id: p.task.id,
        color: c,
      });
    }
    const mins = placed.reduce((s, p) => s + p.task.est_min, 0);
    setMsg(
      `planned ${placed.length} task(s) · ${mins} min on ${planDate} (${kind} windows ${win})` +
        (unplaced.length ? ` · ${unplaced.length} didn't fit: ${unplaced.map((t) => t.title).slice(0, 3).join(", ")}${unplaced.length > 3 ? "…" : ""} — try the next day` : ""),
    );
    calRef.current?.getApi().gotoDate(planDate);
    load();
  };

  const clearPlanned = () =>
    setModal({
      title: `Unplan ${planDate}?`,
      body: "Removes the task blocks auto-planned or dragged onto this day (not template blocks, not done ones). The tasks go back to 'unplanned'.",
      confirmLabel: "Unplan",
      danger: true,
      onConfirm: async () => {
        const mine = events.filter((e) => e.task_id != null && !e.done && ymd(new Date(e.start)) === planDate);
        for (const e of mine) await deleteEvent(e.id);
        setMsg(`removed ${mine.length} task block(s) from ${planDate}`);
        load();
      },
    });

  // Prayer times as thin background bands on every visible day (approximate table).
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null);
  const prayerBands: EventInput[] = useMemo(() => {
    if (!info || !range) return [];
    const out: EventInput[] = [];
    for (let d = new Date(range.start); d < range.end; d.setDate(d.getDate() + 1)) {
      const date = ymd(d);
      for (const [name, t] of Object.entries(info.prayers)) {
        const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (!m) continue;
        const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
        const s = new Date(`${date}T${String(h).padStart(2, "0")}:${m[2]}:00`);
        out.push({
          id: `prayer-${date}-${name}`,
          title: name,
          start: s,
          end: new Date(s.getTime() + 15 * 60000),
          display: "background",
          classNames: ["prayer-band"],
        });
      }
    }
    return out;
  }, [info, range]);

  // A slot block (BUILD / DSA / school) that already holds task blocks turns into a labelled
  // background zone, so the tasks inside it get the full column width.
  const taskSpans = events.filter((e) => e.task_id != null).map((e) => [new Date(e.start).getTime(), new Date(e.end).getTime()]);
  const holdsTasks = (e: CalEvent) => {
    const s = new Date(e.start).getTime();
    const en = new Date(e.end).getTime();
    return taskSpans.some(([a, b]) => a < en && b > s);
  };

  const calEvents: EventInput[] = [
    ...events.map((e) => {
      const t = e.task_id != null ? taskById.get(e.task_id) : undefined;
      const done = !!e.done || t?.status === "done";
      if (e.task_id == null && e.color === TEMPLATE_COLOR && isSlotTitle(e.title) && holdsTasks(e)) {
        return { id: String(e.id), title: e.title, start: e.start, end: e.end, display: "background", classNames: ["slot-zone"] };
      }
      return {
        id: String(e.id),
        title: (done ? "✓ " : "") + e.title,
        start: e.start,
        end: e.end,
        color: e.color || undefined,
        textColor: e.color && e.color !== TEMPLATE_COLOR ? "#000" : undefined,
        classNames: done ? ["opacity-40"] : [],
      };
    }),
    ...prayerBands,
  ];

  return (
    <div className="flex min-h-full flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="cursor font-bold">Planner</h2>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => { setError(""); setEdit({ id: null, title: "", date: planDate, endDate: planDate, start: "09:00", end: "10:00", taskId: null, done: false }); }} className="btn-px bg-accent px-3 py-2 text-sm font-bold text-black">New event</button>
          <button aria-pressed={agenda} onClick={() => setAgenda(!agenda)} className="border border-edge px-3 py-2 text-sm">{agenda ? "Calendar view" : "Agenda view"}</button>
        </div>
      </header>
      {error && !edit && <p role="alert" className="text-sm text-danger">{error}</p>}
      {busy && <p role="status" className="text-sm text-ink-dim">Saving changes...</p>}
      <details className="panel p-3">
        <summary className="text-sm">Planning tools & unplanned tasks ({unplanned.length})</summary>
      <div ref={sidebarRef} className="mt-3 grid gap-4 md:grid-cols-2">
      <div>
        <div className="hd">plan a day</div>
        <div className="panel space-y-3 p-3">
          <input
            aria-label="Planning date"
            type="date"
            value={planDate}
            onChange={(e) => {
              if (!e.target.value) return;
              setPlanDate(e.target.value);
              calRef.current?.getApi().gotoDate(e.target.value);
            }}
            className="w-full border border-edge bg-panel-2 px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <div className="flex gap-1 text-[11px]">
            {[
              ["today", todayStr()],
              ["tomorrow", shiftDay(todayStr(), 1)],
              ...(info && todayStr() < info.day1 ? [["day 1", info.day1]] : []),
            ].map(([l, d]) => (
              <button
                key={l}
                onClick={() => {
                  setPlanDate(d);
                  calRef.current?.getApi().gotoDate(d);
                }}
                className={`flex-1 border px-1 py-1 ${planDate === d ? "border-accent text-accent" : "border-edge text-ink-dim hover:text-ink"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-ink-dim">
            {dayKind(planDate)} · windows from settings · prayers kept free
          </p>
          <button disabled={busy} onClick={() => void perform(seedTemplate)} className="flex w-full items-center gap-2 border border-edge px-3 py-2 text-left text-xs text-ink-dim hover:text-ink">
            <CalIcon className="px-icon h-4 w-4" /> 1 · seed {dayKind(planDate)} template
          </button>
          <button disabled={busy} onClick={() => void perform(runAutoPlan)} className="btn-px flex w-full items-center gap-2 bg-accent px-3 py-2 text-left text-xs font-bold text-black">
            <MagicEdit className="px-icon h-4 w-4" /> 2 · auto-plan open tasks
          </button>
          <button onClick={clearPlanned} className="flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] text-danger/70 hover:text-danger">
            <Trash className="px-icon h-3.5 w-3.5" /> unplan this day
          </button>
          {msg && <p className="text-[11px] leading-relaxed text-accent">{msg}</p>}
        </div>
      </div>
      <div className="space-y-3">
        <div className="hd">unplanned · {unplanned.length}</div>
        <select
          aria-label="Filter unplanned tasks by project"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="w-full border border-edge bg-panel px-2 py-1.5 text-xs"
        >
          <option value="all">all projects</option>
          <option value="none">no project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="text-[11px] leading-relaxed text-ink-dim">drag onto the calendar · or auto-plan</p>
        <div className="space-y-2">
          {unplanned.map((t) => {
            const p = t.project_id != null ? projectById.get(t.project_id) : undefined;
            return (
              <div
                key={t.id}
                data-task={t.id}
                data-title={t.title}
                data-est={t.est_min}
                data-color={colorOf(t)}
                className="panel cursor-grab p-3 text-sm active:cursor-grabbing"
                style={{ borderLeft: `3px solid ${colorOf(t)}` }}
              >
                {t.priority === 1 && <span className="mr-1 text-danger">!</span>}
                {t.title}
                <div className="mt-1 truncate text-[10px] text-ink-dim">
                  {t.kind} · {t.est_min}′{p ? ` · ${p.name}` : ""}
                </div>
              </div>
            );
          })}
          {unplanned.length === 0 && <p className="text-xs text-ink-dim">all open tasks are planned · add more in projects or tasks</p>}
        </div>
      </div>
      </div>
      </details>
      {agenda ? <section className="panel space-y-3 p-4">
        <label className="text-sm">Agenda from <input aria-label="Agenda date" type="date" value={planDate} onChange={(e) => { if (e.target.value) setPlanDate(e.target.value); }} className="ml-2 border border-edge bg-panel-2 p-2" /></label>
        <p className="text-xs text-ink-dim">Next seven days. Select an event to edit it.</p>
        {events.filter((event) => event.end > new Date(`${planDate}T00:00:00`).toISOString() && event.start < new Date(`${shiftDay(planDate, 7)}T00:00:00`).toISOString()).map((event) =>
          <button key={event.id} className="block w-full border border-edge p-3 text-left text-sm" onClick={() => setEdit({ id: event.id, title: event.title, date: ymd(new Date(event.start)), endDate: ymd(new Date(event.end)), start: hm(new Date(event.start)), end: hm(new Date(event.end)), done: !!event.done, taskId: event.task_id })}>
            <span className="block text-xs text-ink-dim">{new Date(event.start).toLocaleString()} - {new Date(event.end).toLocaleString()}</span>
            {event.done ? "Done: " : ""}{event.title}
          </button>)}
      </section> : <div className="min-w-0 flex-1" style={{ minHeight: 600 }}>
        <FullCalendar
          ref={calRef}
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView={window.innerWidth < 900 ? "timeGridDay" : "timeGridWeek"}
          initialDate={planDate}
          headerToolbar={{ left: "prev,next today", center: "title", right: "timeGridDay,timeGridWeek,dayGridMonth" }}
          height={700}
          firstDay={info?.day1_weekday ?? 0 /* weeks start on day 1's weekday, like the plan */}
          allDaySlot={false}
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          scrollTime="08:00:00"
          nowIndicator
          editable
          droppable
          eventTimeFormat={{ hour: "numeric", minute: "2-digit", hour12: true }}
          slotLabelFormat={{ hour: "numeric", hour12: true }}
          events={calEvents}
          datesSet={(arg) => setRange({ start: arg.start, end: arg.end })}
          navLinks
          navLinkDayClick={(d) => {
            setPlanDate(ymd(d));
            calRef.current?.getApi().changeView("timeGridDay", d);
          }}
          eventReceive={async (arg) => {
            const start = arg.event.start!;
            const end = arg.event.end ?? new Date(start.getTime() + 25 * 60000);
            try { await addEvent({
              title: arg.event.title,
              start: start.toISOString(),
              end: end.toISOString(),
              task_id: (arg.event.extendedProps.taskId as number) ?? null,
              color: (arg.event.backgroundColor as string) || KIND_COLORS.code,
            });
            arg.event.remove(); // replaced by the DB-backed event on reload
            await load();
            } catch (e) { arg.revert(); setError(String(e)); }
          }}
          eventDrop={moveEvent}
          eventResize={moveEvent}
          eventClick={clickEvent}
          selectable
          select={(sel) =>
            setModal({
              title: "New block",
              input: { placeholder: "block title…", minLen: 1 },
              confirmLabel: "Add",
              onConfirm: async (title) => {
                await addEvent({ title, start: sel.start.toISOString(), end: sel.end.toISOString(), color: TEMPLATE_COLOR });
                load();
              },
            })
          }
        />
      </div>}
      <Modal req={modal} close={() => setModal(null)} />
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setEdit(null)}>
          <div
            className="panel w-[min(420px,90vw)] space-y-4 bg-panel p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            ref={dialogRef}
            aria-modal="true"
            aria-label={edit.id === null ? "New event" : "Edit event"}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setEdit(null);
            }}
          >
            <div className="hd">{edit.id === null ? "New event" : "Edit event"}</div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <input
              aria-label="Event title"
              autoFocus
              value={edit.title}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              className="w-full border border-edge bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                aria-label="Event start date"
                type="date"
                value={edit.date}
                onChange={(e) => setEdit({ ...edit, date: e.target.value })}
                className="border border-edge bg-panel-2 px-2 py-1.5 outline-none focus:border-accent"
              />
              <input
                aria-label="Event start time"
                type="time"
                value={edit.start}
                onChange={(e) => setEdit({ ...edit, start: e.target.value })}
                className="border border-edge bg-panel-2 px-2 py-1.5 tabular-nums outline-none focus:border-accent"
              />
              <span className="text-ink-dim">→</span>
              <input aria-label="Event end date" type="date" value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} className="border border-edge bg-panel-2 px-2 py-1.5" />
              <input
                aria-label="Event end time"
                type="time"
                value={edit.end}
                onChange={(e) => setEdit({ ...edit, end: e.target.value })}
                className="border border-edge bg-panel-2 px-2 py-1.5 tabular-nums outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <div className="flex gap-2">
                <button disabled={busy || edit.id === null} onClick={() => void perform(removeEdit)} className="border border-danger/40 px-3 py-1.5 text-xs text-danger hover:bg-danger/10">
                  delete
                </button>
                <button disabled={busy || edit.id === null} onClick={() => void perform(toggleDone)} className="border border-edge px-3 py-1.5 text-xs text-ink-dim hover:text-accent">
                  {edit.done ? "mark not done" : "✓ mark done"}
                </button>
              </div>
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => setEdit(null)} className="border border-edge px-4 py-1.5 text-xs text-ink-dim">
                  cancel
                </button>
                <button disabled={busy} onClick={() => void perform(saveEdit)} className="btn-px bg-accent px-4 py-1.5 text-xs font-bold text-black">
                  {busy ? "Saving..." : "Save event"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
