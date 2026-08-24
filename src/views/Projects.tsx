// Projects: a small kanban board (backlog → todo → doing → done) per project, in the spirit
// of open-source boards like Kanboard / Planka / WeKan, built on dnd-kit (MIT). Cards are the
// same tasks the planner schedules, so a project flows: board → calendar → focus → done.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Briefcase, Calendar, Plus, Trash, Pencil } from "pixelarticons/react";
import { todayStr, type CalEvent, type Project, type Task } from "../lib/api";
import { addProject, addTask, deleteProject, deleteTask, listEvents, listProjects, listTasks, updateProject, updateTask } from "../lib/data";
import { KIND_COLORS, ymd } from "../lib/plan";
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
  onPriority?: () => void;
  onStatus?: (status: string) => void;
}

// Presentational card; the DragOverlay renders this directly (no second draggable with the same id).
function CardBody({ task, project, planned, onPlan, onDelete, onPriority, onStatus, overlay }: CardProps & { overlay?: boolean }) {
  const color = project?.color ?? KIND_COLORS[task.kind] ?? KIND_COLORS.other;
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div
      className={`group panel p-3 text-sm ${overlay ? "cursor-grabbing" : "cursor-grab"}`}
      style={{ borderColor: color }}
    >
      <div className="flex items-start gap-2">
        <button
          onPointerDown={stop}
          onClick={onPriority}
          aria-label={`Change priority for ${task.title}`}
          className={`w-3 shrink-0 font-bold ${task.priority === 1 ? "text-danger" : task.priority === 3 ? "text-ink-dim" : "text-ink-faint"}`}
          title="priority (click to change)"
        >
          {task.priority === 1 ? "!" : task.priority === 3 ? "↓" : "·"}
        </button>
        <span className={`min-w-0 flex-1 break-words ${task.status === "done" ? "text-ink-dim line-through" : ""}`}>{task.title}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-dim">
        <span style={{ color: KIND_COLORS[task.kind] }}>{task.kind}</span>
        <span>{task.est_min}′</span>
        {planned && <span className="whitespace-nowrap text-accent">▣ {planned}</span>}
        <span className="ml-auto flex gap-2">
          {!planned && task.status !== "done" && onPlan && (
            <button onPointerDown={stop} onClick={onPlan} aria-label={`Schedule ${task.title}`} className="hover:text-accent" title="schedule on the calendar">
              <Calendar className="px-icon h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <button onPointerDown={stop} onClick={onDelete} aria-label={`Delete ${task.title}`} className="hover:text-danger" title="delete">
              <Trash className="px-icon h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
      {onStatus && <select aria-label={`Status for ${task.title}`} value={task.status} onPointerDown={stop} onChange={(e) => onStatus(e.target.value)} className="mt-2 w-full border border-edge bg-panel-2 p-1 text-xs">{COLUMNS.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}</select>}
    </div>
  );
}

function DraggableCard(props: CardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: props.task.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`touch-none ${isDragging ? "opacity-30" : ""}`}>
      <CardBody {...props} />
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
}: {
  id: string;
  label: string;
  hint: string;
  count: number;
  children: React.ReactNode;
  onAdd?: (title: string) => Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [draft, setDraft] = useState("");
  const over = id === "doing" && count > WIP_LIMIT;
  return (
    <div
      ref={setNodeRef}
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && draft.trim()) {
              try { await onAdd(draft.trim()); setDraft(""); }
              catch { /* The board displays the error and keeps this draft. */ }
            }
          }}
          placeholder="+ add card…"
          className="mb-2 border border-edge bg-panel-2 px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
      )}
      <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto">{children}</div>
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
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [modal, setModal] = useState<ModalRequest | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogFocus(!!form);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = useCallback(async () => {
    const [p, t, e] = await Promise.all([listProjects(), listTasks(), listEvents()]);
    setProjects(p);
    setTasks(t);
    setEvents(e);
  }, []);
  useEffect(() => {
    const refresh = () => { void load().catch((e) => setError(String(e))); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("mizan:data-changed", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("mizan:data-changed", refresh); };
  }, [load]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const roots = tasks.filter((t) => t.parent_id === null);
  const inSel = (t: Task) => (sel === "all" ? true : sel === "none" ? t.project_id == null : t.project_id === sel);
  const visible = roots.filter(inSel);
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

  const onDragStart = (e: DragStartEvent) => setDragging(tasks.find((t) => t.id === e.active.id) ?? null);
  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const t = tasks.find((x) => x.id === e.active.id);
    const to = e.over?.id;
    if (!t || typeof to !== "string" || !COLUMNS.some((column) => column.id === to) || t.status === to) return;
    await perform(() => updateTask(t.id, { status: to }));
  };

  const addCard = async (status: string, title: string) => {
    try {
      await addTask({ title, status, project_id: typeof sel === "number" ? sel : null, kind: "code", est_min: 25 });
      await load();
    } catch (e) { setError(String(e)); throw e; }
  };

  const saveForm = async () => {
    if (!form) return;
    if (!form.name.trim()) throw new Error("Project name is required.");
    const data = { name: form.name.trim(), goal: form.goal.trim(), due: form.due || null, color: form.color };
    if (form.id) await updateProject(form.id, data);
    else await addProject(data);
    setForm(null);
    load();
  };

  const removeProject = (p: Project) =>
    setModal({
      title: `Delete "${p.name}"?`,
      body: "The project goes away; its tasks stay (moved to 'no project').",
      confirmLabel: "Delete project",
      danger: true,
      onConfirm: async () => {
        await deleteProject(p.id);
        setSel("all");
        load();
      },
    });

  return (
    <div className="flex min-h-full flex-col gap-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="cursor font-bold">projects</h2>
          <p className="mt-1 text-sm text-ink-dim">
            one board per mission · drag cards across · todo cards get auto-planned onto the calendar
          </p>
        </div>
        <button
          onClick={() => setForm({ name: "", goal: "", due: "", color: SWATCHES[projects.length % SWATCHES.length] })}
          className="btn-px flex shrink-0 items-center gap-2 whitespace-nowrap bg-accent px-4 py-2 text-sm font-bold text-black"
        >
          <Plus className="px-icon h-4 w-4" /> new project
        </button>
      </header>
      {error && !form && <p role="alert" className="text-sm text-danger">{error}</p>}
      {busy && <p role="status" className="text-sm text-ink-dim">Saving changes...</p>}

      {/* project strip */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["all", "none"] as const).map((k) => (
          <button
            key={k}
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

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="grid min-h-80 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((c) => {
            const cards = visible.filter((t) => (t.status || "open") === c.id);
            return (
              <Column
                key={c.id}
                id={c.id}
                label={c.label}
                hint={c.hint}
                count={cards.length}
                onAdd={c.id === "done" ? undefined : (title) => addCard(c.id, title)}
              >
                {cards.map((t) => (
                  <DraggableCard
                    key={t.id}
                    task={t}
                    project={t.project_id != null ? byId.get(t.project_id) : undefined}
                    planned={planned.get(t.id)}
                    onPlan={() => setScheduling(t)}
                    onDelete={() => setModal({ title: "Delete this task and its subtasks?", confirmLabel: "Delete", danger: true, onConfirm: async () => { await deleteTask(t.id); await load(); } })}
                    onPriority={() => void perform(() => updateTask(t.id, { priority: ((t.priority ?? 2) % 3) + 1 }))}
                    onStatus={(status) => void perform(() => updateTask(t.id, { status }))}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75" onClick={() => setForm(null)}>
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
                    className={`h-5 w-5 ${form.color === c ? "outline-2 outline-offset-2 outline-white" : ""}`}
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
              <button disabled={busy} onClick={() => void perform(saveForm)} className="btn-px bg-accent px-4 py-1.5 text-xs font-bold text-black">
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
