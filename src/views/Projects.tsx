// Projects: a small kanban board (backlog → todo → doing → done) per project, in the spirit
// of open-source boards like Kanboard / Planka / WeKan, built on dnd-kit (MIT). Cards are the
// same tasks the planner schedules, so a project flows: board → calendar → focus → done.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { useNavigate } from "react-router-dom";
import { Briefcase, Plus, Trash, Pencil } from "pixelarticons/react";
import { todayStr, type CalEvent, type Project, type Task } from "../lib/api";
import { addProject, addTask, deleteProject, deleteTask, listEvents, listProjects, listTasks, reorderTask, updateProject, updateTask } from "../lib/data";
import { compareTaskOrder, type TaskMove } from "../lib/taskOrder";
import { KIND_COLORS, ymd } from "../lib/plan";
import { focusLink } from "../lib/focusLink";
import { PixelBar } from "../components/Pixel";
import ScheduleDialog from "../components/ScheduleDialog";
import Modal, { type ModalRequest } from "../components/Modal";
import { useDialogFocus } from "../components/useDialogFocus";

const COLUMNS = [
  { id: "backlog", label: "backlog", hint: "someday · not planned" },
  { id: "open", label: "todo", hint: "next up · auto-plan picks these" },
  { id: "doing", label: "doing", hint: "aim for 3 or fewer" },
  { id: "done", label: "done", hint: "shipped" },
] as const;
const WIP_LIMIT = 3;
const SWATCHES = ["#34d399", "#60a5fa", "#eab308", "#f472b6", "#a78bfa", "#f97316", "#22d3ee"];
const boardCollision: CollisionDetection = (args) => {
  const hits = args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);
  const types = new Map(args.droppableContainers.map((container) => [container.id, container.data.current?.type]));
  const cards = hits.filter((hit) => types.get(hit.id) === "task");
  return cards.length ? cards : hits;
};

function dropPlacement(event: DragEndEvent | DragMoveEvent): "before" | "after" {
  const initialY = "clientY" in event.activatorEvent ? Number(event.activatorEvent.clientY) : null;
  const rect = event.active.rect.current.translated;
  const y = initialY === null ? (rect?.top ?? 0) + (rect?.height ?? 0) / 2 : initialY + event.delta.y;
  return event.over && y > event.over.rect.top + event.over.rect.height / 2 ? "after" : "before";
}

const daysLeft = (due: string) => {
  const [y, m, d] = due.split("-").map(Number);
  const t = new Date();
  return Math.round((new Date(y, m - 1, d).getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86400000);
};

interface ProjectForm {
  id?: number;
  name: string;
  goal: string;
  due: string;
  color: string;
}

interface CardProps {
  task: Task;
  project?: Project;
  planned?: string;
  onPlan?: () => void;
  onDelete?: () => void;
  onPriority?: (priority?: number) => void;
  onStatus?: (status: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  dragHandle?: React.ReactNode;
  disabled?: boolean;
  steps?: Task[];
  onStepStatus?: (id: number, status: string) => void;
}

// One "⋯" menu instead of a row of buttons on every card: the board stays readable,
// and every action (including the keyboard alternative to dragging) is still one click away.
function CardMenu({ task, planned, disabled, onPlan, onDelete, onStatus, onMoveUp, onMoveDown, onPriority }: CardProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    root.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [open]);
  const act = (fn?: () => void) => () => { setOpen(false); fn?.(); };
  const item = "block w-full px-3 py-2 text-left hover:bg-accent-dim hover:text-ink focus:bg-accent-dim focus:outline-none disabled:opacity-40";
  const live = task.status !== "done";
  return (
    <div ref={root} className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" disabled={disabled} aria-label={`Actions for ${task.title}`} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} className="flex min-h-9 min-w-7 items-center justify-center text-base leading-none text-ink-dim hover:text-ink">⋯</button>
      {open && (
        <div role="menu" aria-label={`Actions for ${task.title}`} className="absolute right-0 top-full z-30 mt-1 w-52 border border-edge bg-panel-2 py-1 text-xs shadow-xl"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = [...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
          }}>
          {live && <button role="menuitem" className={item} onClick={act(() => navigate(focusLink(task)))}>Focus on this</button>}
          {live && !planned && onPlan && <button role="menuitem" className={item} onClick={act(onPlan)}>Schedule…</button>}
          {onPriority && <>
            <div className="my-1 border-t border-edge" />
            {[[1, "Mark important"], [2, "Normal priority"], [3, "Mark low priority"]].filter(([p]) => p !== (task.priority ?? 2)).map(([p, label]) => (
              <button key={p} role="menuitem" className={item} onClick={act(() => onPriority(p as number))}>{label}</button>
            ))}
          </>}
          {onStatus && <>
            <div className="my-1 border-t border-edge" />
            <button role="menuitem" className={item} disabled={!onMoveUp} onClick={act(onMoveUp)}>Move up</button>
            <button role="menuitem" className={item} disabled={!onMoveDown} onClick={act(onMoveDown)}>Move down</button>
            {COLUMNS.filter((c) => c.id !== task.status).map((c) => (
              <button key={c.id} role="menuitem" className={item} onClick={act(() => onStatus(c.id))}>Move to {c.label}</button>
            ))}
          </>}
          {onDelete && <>
            <div className="my-1 border-t border-edge" />
            <button role="menuitem" className={`${item} text-danger`} onClick={act(onDelete)}>Delete</button>
          </>}
        </div>
      )}
    </div>
  );
}

// Presentational card; the DragOverlay renders this directly (no second draggable with the same id).
function CardBody(props: CardProps & { overlay?: boolean }) {
  const { task, project, planned, onPriority, dragHandle, disabled, steps = [], onStepStatus, overlay } = props;
  const color = project?.color ?? KIND_COLORS[task.kind] ?? KIND_COLORS.other;
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const doneSteps = steps.filter((step) => step.status === "done").length;
  return (
    <div
      className={`group panel kcard p-2.5 text-sm ${overlay ? "cursor-grabbing shadow-2xl" : ""}`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-start gap-1.5">
        {dragHandle}
        <span className={`min-w-0 flex-1 break-words pt-1.5 ${task.status === "done" ? "text-ink-dim line-through" : ""}`}>{task.title}</span>
        {onPriority && task.priority !== 2 && <button
          disabled={disabled}
          onPointerDown={stop}
          onClick={() => onPriority()}
          aria-label={`Change priority for ${task.title}`}
          className={`min-h-9 min-w-7 shrink-0 font-bold ${task.priority === 1 ? "text-danger" : "text-ink-dim"}`}
          title={task.priority === 1 ? "Important (click to change)" : task.priority === 3 ? "Low priority (click to change)" : "Normal priority (click to change)"}
        >
          {task.priority === 1 ? "!" : task.priority === 3 ? "↓" : "·"}
        </button>}
        {!overlay && <span className="card-reveal shrink-0"><CardMenu {...props} /></span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-9 text-xs text-ink-dim">
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLORS[task.kind] ?? KIND_COLORS.other }} />{task.kind}</span>
        <span>{task.est_min}′</span>
        {!!steps.length && <span>{doneSteps}/{steps.length} steps</span>}
        {planned && <span className="whitespace-nowrap text-accent">▣ {planned}</span>}
      </div>
      {!!steps.length && !overlay && <details className="mt-1 pl-9">
        <summary className="min-h-9 content-center text-xs text-ink-dim">Show steps</summary>
        <ul className="space-y-1">
          {steps.map((step) => <li key={step.id}><label className="flex min-h-9 items-start gap-2 py-1 text-xs">
            <input type="checkbox" disabled={disabled || !onStepStatus} aria-label={`Complete ${step.title}`} checked={step.status === "done"} onChange={(event) => onStepStatus?.(step.id, event.target.checked ? "done" : "open")} className="mt-0.5 h-4 w-4 shrink-0" />
            <span className={`min-w-0 break-words ${step.status === "done" ? "line-through text-ink-dim" : ""}`}>{step.title}</span>
          </label></li>)}
        </ul>
      </details>}
    </div>
  );
}

function DraggableCard(props: CardProps & { dropHint?: "before" | "after" }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: props.task.id, disabled: props.disabled });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: props.task.id, data: { type: "task" }, disabled: props.disabled });
  const ref = useCallback((node: HTMLDivElement | null) => { setNodeRef(node); setDropRef(node); }, [setNodeRef, setDropRef]);
  return (
    <div ref={ref} data-task-id={props.task.id} className={`relative ${isDragging ? "opacity-30" : ""}`}>
      {isOver && !isDragging && <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 z-10 h-1 bg-accent ${props.dropHint === "after" ? "bottom-0" : "top-0"}`} />}
      <CardBody {...props} dragHandle={<button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={props.disabled}
        aria-label={`Drag ${props.task.title}`} title="Drag to reorder, or use the up and down buttons"
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") { event.preventDefault(); props.onMoveUp?.(); }
          if (event.key === "ArrowDown") { event.preventDefault(); props.onMoveDown?.(); }
        }}
        className="flex min-h-9 min-w-7 shrink-0 touch-none select-none items-center justify-center text-base leading-none text-ink-faint hover:text-ink cursor-grab active:cursor-grabbing"><span aria-hidden="true">⠿</span></button>} />
    </div>
  );
}

function Column({
  id,
  label,
  hint,
  count,
  children,
  onAdd,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  count: number;
  children: React.ReactNode;
  onAdd?: (title: string) => Promise<void>;
  disabled?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: "column" }, disabled });
  const [draft, setDraft] = useState("");
  const adding = useRef(false);
  const over = id === "doing" && count > WIP_LIMIT;
  return (
    <div
      ref={setNodeRef}
      role="region"
      aria-label={`${label} column`}
      className={`flex min-h-0 min-w-0 flex-1 flex-col border bg-panel/60 p-2 transition-colors ${
        isOver ? "border-accent bg-accent-dim" : "border-edge"
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between px-1">
        <span className="font-pixel-sm text-xs uppercase tracking-widest">{label}</span>
        <span className={`font-digits text-lg ${over ? "text-danger" : "text-ink-dim"}`}>
          {count}
          {id === "doing" ? `/${WIP_LIMIT}` : ""}
        </span>
      </div>
      <p className={`mb-2 px-1 text-[10px] ${over ? "text-danger" : "text-ink-dim"}`}>{over ? "too much in progress — finish one first" : hint}</p>
      {onAdd && (
        <input
          aria-label={`Add ${label} card`}
          disabled={disabled}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && draft.trim() && !adding.current) {
              adding.current = true;
              try { await onAdd(draft.trim()); setDraft(""); }
              catch { /* The board displays the error and keeps this draft. */ }
              finally { adding.current = false; }
            }
          }}
          placeholder="+ add card…"
          className="mb-2 border border-edge bg-panel-2 px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
      )}
      {/* Long columns scroll inside the board instead of stretching the page. */}
      <div className="flex max-h-[max(20rem,calc(100vh-19rem))] min-h-16 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-1">{children}</div>
    </div>
  );
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [sel, setSel] = useState<number | "all" | "none">("all");
  const [form, setForm] = useState<ProjectForm | null>(null);
  const [dragging, setDragging] = useState<Task | null>(null);
  const [dropHint, setDropHint] = useState<{ id: number; placement: "before" | "after" } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [modal, setModal] = useState<ModalRequest | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const actionLock = useRef(false);
  const loadVersion = useRef(0);
  const dialogRef = useDialogFocus(!!form);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const [p, t, e] = await Promise.all([listProjects(), listTasks(), listEvents()]);
      if (version === loadVersion.current) { setProjects(p); setTasks(t); setEvents(e); }
    } finally { if (version === loadVersion.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const refresh = () => { if (!actionLock.current) void load().catch((e) => setError(String(e))); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("mizan:data-changed", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("mizan:data-changed", refresh); };
  }, [load]);
  const perform = async (action: () => Promise<void>) => {
    if (actionLock.current) throw new Error("Wait for the current change to finish.");
    actionLock.current = true;
    setBusy(true); setError("");
    try { await action(); }
    catch (e) { setError(String(e)); throw e; }
    finally {
      try { await load(); }
      catch (e) { setError(String(e)); }
      actionLock.current = false; setBusy(false);
    }
  };
  const run = async (action: () => Promise<void>) => {
    try { await perform(action); }
    catch (e) { setError(String(e)); }
  };

  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const roots = tasks.filter((t) => t.parent_id === null);
  const inSel = (t: Task) => (sel === "all" ? true : sel === "none" ? t.project_id == null : t.project_id === sel);
  const visible = roots.filter(inSel).sort(compareTaskOrder);
  const current = typeof sel === "number" ? byId.get(sel) : undefined;

  const planned = useMemo(() => {
    const m = new Map<number, string>();
    const now = Date.now();
    for (const e of events) {
      if (e.task_id == null || new Date(e.end).getTime() < now || m.has(e.task_id)) continue;
      const d = new Date(e.start);
      m.set(e.task_id, ymd(d) === todayStr() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }));
    }
    return m;
  }, [events]);

  const progress = (pid: number) => {
    const ts = roots.filter((t) => t.project_id === pid);
    return { done: ts.filter((t) => t.status === "done").length, total: ts.length };
  };

  const moveCard = async (task: Task, destination: Omit<TaskMove, "id">) => {
    await run(async () => {
      await reorderTask(task.id, destination);
      const column = COLUMNS.find((item) => item.id === destination.status);
      setAnnouncement(`Moved ${task.title} in ${column?.label ?? destination.status}.`);
    });
  };
  const columnDestination = (task: Task, status: string): Omit<TaskMove, "id"> => {
    const lane = visible.filter((item) => item.status === status && item.id !== task.id);
    return { status, targetId: lane[lane.length - 1]?.id, placement: "after" };
  };
  const onDragStart = (e: DragStartEvent) => { setError(""); setDragging(tasks.find((t) => t.id === e.active.id) ?? null); };
  const onDragMove = (e: DragMoveEvent) => {
    const next = typeof e.over?.id === "number" ? { id: e.over.id, placement: dropPlacement(e) } : null;
    // Pointer moves fire constantly; only re-render the board when the drop indicator actually changes.
    setDropHint((prev) => prev?.id === next?.id && prev?.placement === next?.placement ? prev : next);
  };
  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null); setDropHint(null);
    const t = tasks.find((x) => x.id === e.active.id);
    const to = e.over?.id;
    if (!e.over || to === e.active.id) return;
    if (!t) { setError("Task no longer exists. Reload the board."); return; }
    if (typeof to === "number") {
      const target = tasks.find((item) => item.id === to);
      if (!target) { setError("The drop target changed. Try moving the task again."); return; }
      await moveCard(t, { status: target.status, targetId: target.id, placement: dropPlacement(e) });
    } else if (typeof to === "string" && COLUMNS.some((column) => column.id === to)) {
      await moveCard(t, columnDestination(t, to));
    } else {
      setError("Choose a task or column as the drop target.");
    }
  };

  const addCard = async (status: string, title: string) => {
    await perform(async () => {
      await addTask({ title, status, project_id: typeof sel === "number" ? sel : null, kind: "code", est_min: 25 });
    });
  };

  const saveForm = async () => {
    if (!form) return;
    if (!form.name.trim()) throw new Error("Project name is required.");
    const data = { name: form.name.trim(), goal: form.goal.trim(), due: form.due || null, color: form.color };
    if (form.id) await updateProject(form.id, data);
    else await addProject(data);
    setForm(null);
  };

  const removeProject = (p: Project) =>
    setModal({
      title: `Delete "${p.name}"?`,
      body: "The project goes away; its tasks stay (moved to 'no project').",
      confirmLabel: "Delete project",
      danger: true,
      onConfirm: () => perform(async () => {
        await deleteProject(p.id);
        setSel("all");
      }),
    });

  return (
    <div className="flex min-h-full flex-col gap-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="cursor font-bold">Projects</h2>
          <p className="mt-1 text-sm text-ink-dim">
            Drag the ⠿ handle to reorder or move a card. The ⋯ menu has the same moves, plus focus, schedule and delete.
          </p>
        </div>
        <button
          disabled={busy || !!dragging}
          onClick={() => setForm({ name: "", goal: "", due: "", color: SWATCHES[projects.length % SWATCHES.length] })}
          className="btn-px flex shrink-0 items-center gap-2 whitespace-nowrap bg-accent px-4 py-2 text-sm font-bold text-black"
        >
          <Plus className="px-icon h-4 w-4" /> New project
        </button>
      </header>
      {error && !form && <p role="alert" className="text-sm text-danger">{error}</p>}
      {busy && <p role="status" className="text-sm text-ink-dim">Saving changes...</p>}
      {loading && <p role="status" className="text-sm text-ink-dim">Loading board...</p>}
      <p role="status" className="sr-only">{announcement}</p>

      {/* project strip */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["all", "none"] as const).map((k) => (
          <button
            key={k}
            disabled={busy || !!dragging}
            onClick={() => setSel(k)}
            className={`shrink-0 border px-3 py-2 text-xs ${sel === k ? "border-accent text-accent" : "border-edge text-ink-dim hover:text-ink"}`}
          >
            {k === "all" ? `all · ${roots.length}` : `no project · ${roots.filter((t) => t.project_id == null).length}`}
          </button>
        ))}
        {projects.map((p) => {
          const pr = progress(p.id);
          const dl = p.due ? daysLeft(p.due) : null;
          return (
            <button
              key={p.id}
              disabled={busy || !!dragging}
              onClick={() => setSel(p.id)}
              className={`w-48 shrink-0 border p-2 text-left ${sel === p.id ? "bg-panel-2" : "hover:bg-panel-2"}`}
              style={{ borderColor: sel === p.id ? p.color : "var(--color-edge)" }}
            >
              <div className="flex items-center gap-2 text-xs">
                <Briefcase className="px-icon h-3.5 w-3.5" style={{ color: p.color }} />
                <span className="truncate">{p.name}</span>
              </div>
              <PixelBar value={pr.done} max={Math.max(1, pr.total)} segments={12} color={p.color} className="mt-2" />
              <div className="mt-1 flex justify-between text-[10px] text-ink-dim">
                <span>
                  {pr.done}/{pr.total} done
                </span>
                {dl !== null && <span className={dl < 0 ? "text-danger" : dl <= 2 ? "text-gold" : ""}>{dl < 0 ? `${-dl}d late` : `${dl}d left`}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {current && (
        <div className="flex items-center gap-4 border-l-2 px-3 text-sm" style={{ borderColor: current.color }}>
          <span className="text-ink-dim">goal ❯</span>
          <span className="flex-1">{current.goal || <span className="text-ink-dim">no goal written — a project without a finish line never ships</span>}</span>
          {current.due && <span className="text-xs text-ink-dim">due {current.due}</span>}
          <button
            onClick={() => setForm({ id: current.id, name: current.name, goal: current.goal, due: current.due ?? "", color: current.color })}
            className="text-ink-dim hover:text-ink"
            title="edit project"
          >
            <Pencil className="px-icon h-4 w-4" />
          </button>
          <button onClick={() => removeProject(current)} className="text-danger/60 hover:text-danger" title="delete project">
            <Trash className="px-icon h-4 w-4" />
          </button>
        </div>
      )}

      <DndContext key={sel} sensors={sensors} collisionDetection={boardCollision} onDragStart={onDragStart} onDragMove={onDragMove} onDragOver={onDragMove} onDragEnd={onDragEnd}
        onDragCancel={() => { setDragging(null); setDropHint(null); setAnnouncement("Move cancelled. Task order is unchanged."); }}
        accessibility={{ screenReaderInstructions: { draggable: "Drag with a pointer, or press the up and down arrow keys on this handle. You can also use the Move and Move to options in each card’s actions menu." } }}>
        <div className="grid min-h-80 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((c) => {
            const cards = visible.filter((t) => t.status === c.id);
            return (
              <Column
                key={c.id}
                id={c.id}
                label={c.label}
                hint={c.hint}
                count={cards.length}
                disabled={busy}
                onAdd={c.id === "done" ? undefined : (title) => addCard(c.id, title)}
              >
                {cards.map((t, index) => (
                  <DraggableCard
                    key={t.id}
                    task={t}
                    project={t.project_id != null ? byId.get(t.project_id) : undefined}
                    planned={planned.get(t.id)}
                    disabled={busy}
                    dropHint={dropHint?.id === t.id ? dropHint.placement : undefined}
                    steps={tasks.filter((step) => step.parent_id === t.id).sort(compareTaskOrder)}
                    onStepStatus={(id, status) => void run(() => updateTask(id, { status }))}
                    onPlan={() => setScheduling(t)}
                    onDelete={() => setModal({ title: "Delete this task and its subtasks?", confirmLabel: "Delete", danger: true, onConfirm: () => perform(() => deleteTask(t.id)) })}
                    onPriority={(p) => void run(() => updateTask(t.id, { priority: p ?? ((t.priority ?? 2) % 3) + 1 }))}
                    onStatus={(status) => void moveCard(t, columnDestination(t, status))}
                    onMoveUp={index > 0 ? () => void moveCard(t, { status: t.status, targetId: cards[index - 1].id, placement: "before" }) : undefined}
                    onMoveDown={index < cards.length - 1 ? () => void moveCard(t, { status: t.status, targetId: cards[index + 1].id, placement: "after" }) : undefined}
                  />
                ))}
              </Column>
            );
          })}
        </div>
        <DragOverlay>
          {dragging && <CardBody task={dragging} project={dragging.project_id != null ? byId.get(dragging.project_id) : undefined} overlay />}
        </DragOverlay>
      </DndContext>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75" onClick={() => { if (!busy) setForm(null); }}>
          <div
            className="panel w-[min(460px,92vw)] space-y-3 bg-panel p-5"
            role="dialog"
            ref={dialogRef}
            aria-modal="true"
            aria-label="Project details"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setForm(null);
            }}
          >
            <div className="hd">{form.id ? "edit project" : "new project"}</div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <input
              aria-label="Project name"
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Project name"
              className="w-full border border-edge bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <textarea
              aria-label="Project goal"
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              rows={2}
              placeholder="finish line in one sentence — what exists when this is done?"
              className="w-full resize-none border border-edge bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="text-xs text-ink-dim">due</label>
              <input
                aria-label="Project due date"
                type="date"
                value={form.due}
                onChange={(e) => setForm({ ...form, due: e.target.value })}
                className="border border-edge bg-panel-2 px-2 py-1.5 outline-none focus:border-accent"
              />
              <span className="ml-auto flex gap-1">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setForm({ ...form, color: c })}
                    className={`h-5 w-5 ${form.color === c ? "outline-2 outline-offset-2 outline-ink" : ""}`}
                    style={{ background: c }}
                    aria-label={`colour ${c}`}
                  />
                ))}
              </span>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button disabled={busy} onClick={() => setForm(null)} className="border border-edge px-4 py-1.5 text-xs text-ink-dim">
                cancel
              </button>
              <button disabled={busy} onClick={() => void run(saveForm)} className="btn-px bg-accent px-4 py-1.5 text-xs font-bold text-black">
                {busy ? "Saving..." : form.id ? "save" : "create"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ScheduleDialog
        task={scheduling}
        color={scheduling?.project_id != null ? byId.get(scheduling.project_id)?.color : undefined}
        close={() => setScheduling(null)}
        done={load}
      />
      <Modal req={modal} close={() => setModal(null)} />
    </div>
  );
}
