import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { todayStr, type Project, type Task } from "../lib/api";
import { addTask, addTaskSteps, clearTaskSteps, deleteTask, listProjects, listTasks, updateTask } from "../lib/data";
import { useNavigate } from "react-router-dom";
import ScheduleDialog from "../components/ScheduleDialog";
import { focusLink } from "../lib/focusLink";
import Modal, { type ModalRequest } from "../components/Modal";
import TaskViews from "../components/TaskViews";
import { useDialogFocus } from "../components/useDialogFocus";
import { DEFAULT_QUERY, queryTasks } from "../lib/workflows";
import { MAX_BREAKDOWN_STEPS, MAX_STEP_MINUTES, distributeStepEstimates, extractListedSteps, suggestTaskSteps, taskTreeRoots, validateTaskSteps, type BreakdownStep } from "../lib/taskBreakdown";
import { compareTaskOrder } from "../lib/taskOrder";
import { TASK_KINDS, TASK_STATUSES } from "../lib/taskRules";

function BreakdownDialog({ task, tasks, apply, close }: {
  task: Task;
  tasks: Task[];
  apply: (steps: BreakdownStep[]) => Promise<void>;
  close: () => void;
}) {
  const [steps, setSteps] = useState(() => {
    const key = (title: string) => title.trim().replace(/\s+/g, " ").normalize("NFKC").toLowerCase();
    const taken = new Set(tasks.filter((item) => item.parent_id === task.id).map((item) => key(item.title)));
    const fresh = suggestTaskSteps(task).filter((step) => !taken.has(key(step.title)));
    return (fresh.length ? fresh : [{ title: "", est_min: 15 }]).map((step, i) => ({ ...step, key: i }));
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const nextKey = useRef(steps.length);
  const dialogRef = useDialogFocus(true);
  const headingId = useId();
  const existing = tasks.filter((item) => item.parent_id === task.id).sort(compareTaskOrder);
  const [pasted, setPasted] = useState("");
  const usePasted = () => {
    const lines = pasted.split("\n").map((line) => line.trim()).filter(Boolean);
    const items = extractListedSteps(pasted).length ? extractListedSteps(pasted) : lines.map((line) => line.replace(/^(?:[-*•+]|\d{1,2}[.):])\s+/, ""));
    if (!items.length) { setError("Type at least one step, one per line."); return; }
    const estimates = distributeStepEstimates(task.est_min, items.map(() => 1));
    setSteps(items.slice(0, MAX_BREAKDOWN_STEPS).map((title, i) => ({ title, est_min: estimates[i] ?? 5, key: nextKey.current++ })));
    setPasted(""); setError("");
  };
  const total = steps.reduce((sum, step) => sum + (Number.isFinite(step.est_min) ? step.est_min : 0), 0);
  const cancel = () => { if (!lock.current) close(); };
  const submit = async () => {
    if (lock.current) return;
    setError("");
    try {
      const parent = tasks.find((item) => item.id === task.id);
      if (!parent) throw new Error("Task no longer exists.");
      const validated = validateTaskSteps(parent, steps, tasks);
      lock.current = true;
      setBusy(true);
      await apply(validated);
      close();
    } catch (e) { setError(String(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={cancel}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-busy={busy}
        className="panel max-h-[90dvh] w-full max-w-2xl overflow-y-auto bg-panel p-4 sm:p-6"
        onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }}>
        <h3 id={headingId} className="font-bold">{existing.length ? "Add more steps" : "Break into steps"}</h3>
        <p className="mt-2 break-words text-sm">{task.title}</p>
        <p className="mt-2 text-sm text-ink-dim">These are starting suggestions, made on this computer from the task’s title, notes and category. If the title or notes already contain a list, each item becomes a step. Edit, remove or add steps before saving.</p>
        {existing.length > 0 && <div className="mt-3 border border-edge p-3 text-xs">
          <p className="text-ink-dim">Existing steps ({existing.length}). New steps go after these.</p>
          <ol className="mt-1 list-decimal pl-5">{existing.map((item) => <li key={item.id} className={item.status === "done" ? "line-through text-ink-dim" : ""}>{item.title}</li>)}</ol>
        </div>}
        <details className="mt-3">
          <summary className="min-h-11 content-center text-sm text-ink-dim">Paste or type your own list</summary>
          <textarea aria-label="Steps, one per line" value={pasted} onChange={(event) => setPasted(event.target.value)} rows={4} placeholder={"One step per line\nOutline\nDraft\nReview"} className="mt-2 block w-full border border-edge bg-panel-2 p-2 text-sm" />
          <button type="button" onClick={usePasted} className="mt-2 min-h-11 border border-edge px-3 text-sm">Use this list</button>
        </details>
        <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <ol className="space-y-3">
            {steps.map((step, i) => <li key={step.key} className="border border-edge p-3">
              <label className="block text-xs">Step {i + 1}
                <textarea required maxLength={300} disabled={busy} aria-label={`Step ${i + 1} title`} value={step.title}
                  onChange={(event) => setSteps((rows) => rows.map((row) => row.key === step.key ? { ...row, title: event.target.value } : row))}
                  rows={2} className="mt-2 block w-full resize-y border border-edge bg-panel-2 p-2 text-sm" />
              </label>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                <label className="text-xs">Minutes
                  <input type="number" required min={5} max={MAX_STEP_MINUTES} step={1} disabled={busy} aria-label={`Step ${i + 1} minutes`} value={Number.isNaN(step.est_min) ? "" : step.est_min}
                    onChange={(event) => setSteps((rows) => rows.map((row) => row.key === step.key ? { ...row, est_min: event.target.valueAsNumber } : row))}
                    className="ml-2 min-h-11 w-24 border border-edge bg-panel-2 p-2 text-sm" />
                </label>
                <button type="button" disabled={busy} aria-label={`Remove step ${i + 1}`} onClick={() => setSteps((rows) => rows.filter((row) => row.key !== step.key))} className="min-h-11 border border-edge px-3 text-xs">Remove</button>
              </div>
            </li>)}
          </ol>
          <button type="button" disabled={busy || steps.length >= MAX_BREAKDOWN_STEPS} onClick={() => {
            const key = nextKey.current++;
            setSteps((rows) => [...rows, { key, title: "", est_min: 5 }]);
          }} className="min-h-11 border border-edge px-3 text-sm">Add a manual step</button>
          <p className="text-xs text-ink-dim">{steps.length} steps · {total} min total · Parent estimate: {task.est_min} min. Steps copy the task’s category, project, priority and due date.</p>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" disabled={busy} onClick={cancel} className="min-h-11 border border-edge px-4 text-sm">Cancel</button>
            <button type="submit" disabled={busy || !steps.length} className="btn-px min-h-11 bg-accent px-4 text-sm font-bold text-black">{busy ? "Saving steps..." : `Add ${steps.length} ${steps.length === 1 ? "step" : "steps"}`}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Tasks() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("other");
  const [estimate, setEstimate] = useState(25);
  const [priority, setPriority] = useState(2);
  const [due, setDue] = useState("");
  const [project, setProject] = useState("");
  const [query, setQuery] = useState({ ...DEFAULT_QUERY });
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [breakdown, setBreakdown] = useState<Task | null>(null);
  const [stepDrafts, setStepDrafts] = useState<Record<number, string>>({});
  const [addingStep, setAddingStep] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalRequest | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const actionLock = useRef(false);
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const [all, ps] = await Promise.all([listTasks(), listProjects()]);
      if (version === loadVersion.current) { setTasks(all); setProjects(ps); }
    } catch (e) { if (version === loadVersion.current) setError(String(e)); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, []);

  useEffect(() => {
    const refresh = () => { if (!actionLock.current) void load(); };
    void load();
    window.addEventListener("focus", refresh);
    window.addEventListener("mizan:data-changed", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("mizan:data-changed", refresh); };
  }, [load]);

  const perform = async (action: () => Promise<void>) => {
    if (actionLock.current) throw new Error("Wait for the current change to finish.");
    actionLock.current = true;
    setBusy(true); setError("");
    try { await action(); await load(); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const run = async (action: () => Promise<void>) => {
    if (actionLock.current) return;
    try { await perform(action); }
    catch (e) { setError(String(e)); }
  };
  const saveTitle = (task: Task) => run(async () => {
    await updateTask(task.id, { title: editText.trim() });
    setEditing(null);
  });
  const visible = queryTasks(tasks, query, todayStr());
  const roots = taskTreeRoots(tasks, visible);
  const matching = new Set(visible.map((task) => task.id));
  const childrenByParent = useMemo(() => {
    const children = new Map<number, Task[]>();
    for (const task of tasks) {
      if (task.parent_id === null) continue;
      children.set(task.parent_id, [...(children.get(task.parent_id) ?? []), task]);
    }
    for (const group of children.values()) group.sort(compareTaskOrder);
    return children;
  }, [tasks]);

  const openBreakdown = (task: Task) => {
    try { suggestTaskSteps(task); setBreakdown(task); }
    catch (e) { setError(String(e)); }
  };
  const addQuickStep = (task: Task) => {
    const text = (stepDrafts[task.id] ?? "").trim();
    if (!text) return;
    void run(async () => {
      await addTaskSteps(task.id, [{ title: text, est_min: 15 }]);
      setStepDrafts((drafts) => ({ ...drafts, [task.id]: "" }));
    });
  };
  const titleEditor = (task: Task, className: string) => editing === task.id ?
    <input aria-label="Edit task title" autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} onBlur={() => void saveTitle(task)} onKeyDown={(e) => {
      if (e.key === "Enter") void saveTitle(task);
      if (e.key === "Escape") setEditing(null);
    }} className="min-h-11 min-w-0 flex-1 border border-accent bg-panel-2 p-2 text-sm" /> :
    <button disabled={busy} title="Click to rename" onClick={() => { setEditing(task.id); setEditText(task.title); }} className={`${className} min-w-0 flex-1 break-words text-left text-sm ${task.status === "done" ? "line-through text-ink-dim" : ""}`}>{task.title}</button>;

  const renderStep = (step: Task, ancestors: Set<number>): ReactNode => {
    const path = new Set([...ancestors, step.id]);
    const nested = (childrenByParent.get(step.id) ?? []).filter((child) => !path.has(child.id));
    return <li key={step.id}>
      <div className="group flex items-center gap-1">
        <label className="flex min-h-10 min-w-10 shrink-0 items-center justify-center">
          <input type="checkbox" aria-label={`Complete step ${step.title}`} checked={step.status === "done"} disabled={busy} onChange={(e) => void run(() => updateTask(step.id, { status: e.target.checked ? "done" : "open" }))} className="h-4 w-4" />
        </label>
        {titleEditor(step, "min-h-10")}
        <span className="shrink-0 text-[11px] text-ink-dim">{step.est_min}m</span>
        <button disabled={busy} aria-label={`Delete step ${step.title}`} title="Delete step" onClick={() => void run(() => deleteTask(step.id))} className="min-h-10 min-w-10 shrink-0 text-ink-dim hover:text-danger">×</button>
      </div>
      {nested.length > 0 && <ul className="ml-6 border-l border-edge pl-2">{nested.map((child) => renderStep(child, path))}</ul>}
    </li>;
  };

  const renderTask = (task: Task): ReactNode => {
    const path = new Set([task.id]);
    const children = (childrenByParent.get(task.id) ?? []).filter((child) => !path.has(child.id));
    const completed = children.filter((child) => child.status === "done").length;
    const open = task.status !== "done";
    return <li key={task.id} className="panel px-4 py-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-[14rem] flex-1 items-start gap-2">
          <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
            <input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.status === "done"} disabled={busy} onChange={(e) => void run(() => updateTask(task.id, { status: e.target.checked ? "done" : "open" }))} className="h-4 w-4" />
          </label>
          {titleEditor(task, "min-h-11")}
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap gap-2 max-sm:ml-0 max-sm:pl-13">
          {open && <button disabled={busy} onClick={() => navigate(focusLink(task))} className="min-h-11 shrink-0 border border-edge px-2 text-xs hover:text-accent" aria-label={`Focus on ${task.title}`}>Focus</button>}
          {open && <button disabled={busy} onClick={() => openBreakdown(task)} className="min-h-11 shrink-0 border border-edge px-2 text-xs">{children.length ? "+ Steps" : "Break into steps"}</button>}
          <button disabled={busy || !open} onClick={() => setScheduling(task)} className="min-h-11 shrink-0 border border-edge px-2 text-xs">Schedule</button>
        </div>
      </div>
      <p className="mt-1 pl-13 text-xs text-ink-dim">{task.priority === 1 ? "Important · " : ""}{task.kind} · {task.est_min} min{task.due ? ` · Due ${task.due}` : ""}{task.parent_id !== null ? " · Step of another task" : ""}{task.project_id !== null ? ` · ${projects.find((p) => p.id === task.project_id)?.name ?? "Project"}` : ""}{!matching.has(task.id) ? " · Shown for context" : ""}</p>
      {children.length > 0 && <section className="mt-3 border-t border-edge pt-3" aria-label={`Steps for ${task.title}`}>
        <div className="flex items-center gap-3">
          <progress aria-label={`Step progress for ${task.title}`} value={completed} max={children.length} className="h-2 flex-1 accent-accent" />
          <span className="text-xs text-ink-dim">{completed}/{children.length} steps</span>
        </div>
        {completed === children.length && open && <p className="mt-2 text-xs text-accent">All steps done. Tick the task when the whole thing is finished.</p>}
        <ul className="mt-2">{children.map((child) => renderStep(child, path))}</ul>
      </section>}
      {open && (children.length > 0 || addingStep === task.id) && <form className="mt-1 flex gap-2 pl-10" onSubmit={(event) => { event.preventDefault(); addQuickStep(task); }}>
        <input aria-label={`Add a step to ${task.title}`} disabled={busy} value={stepDrafts[task.id] ?? ""} autoFocus={addingStep === task.id}
          onChange={(event) => setStepDrafts((drafts) => ({ ...drafts, [task.id]: event.target.value }))}
          placeholder="Add a step and press Enter" className="min-h-10 min-w-0 flex-1 border border-edge bg-panel-2 px-2 text-sm" />
      </form>}
      <details className="mt-1 pl-13">
        <summary className="min-h-9 content-center text-xs text-ink-dim">Edit details</summary>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-xs">Status<select aria-label={`Status for ${task.title}`} disabled={busy} value={task.status} onChange={(e) => void run(() => updateTask(task.id, { status: e.target.value }))} className="mt-1 block min-h-11 border border-edge bg-panel-2 p-2">{TASK_STATUSES.map((status) => <option key={status} value={status}>{status === "open" ? "To do" : status}</option>)}</select></label>
          <label className="text-xs">Priority<select aria-label={`Priority for ${task.title}`} disabled={busy} value={task.priority} onChange={(e) => void run(() => updateTask(task.id, { priority: Number(e.target.value) }))} className="mt-1 block min-h-11 border border-edge bg-panel-2 p-2"><option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option></select></label>
          <label className="text-xs">Due date<input aria-label={`Due date for ${task.title}`} disabled={busy} type="date" value={task.due ?? ""} onChange={(e) => void run(() => updateTask(task.id, { due: e.target.value || null }))} className="mt-1 block min-h-11 border border-edge bg-panel-2 p-2" /></label>
          {open && !children.length && <button disabled={busy} onClick={() => setAddingStep(task.id)} className="min-h-11 border border-edge px-3 text-xs">Add one step</button>}
          {children.length > 0 && <button disabled={busy} onClick={() => setModal({ title: `Remove all ${children.length} steps?`, body: "The task stays. Its steps are deleted, and calendar blocks are kept but detached from them.", confirmLabel: "Remove steps", danger: true, onConfirm: () => perform(() => clearTaskSteps(task.id)) })} className="min-h-11 border border-danger/60 px-3 text-xs text-danger">Remove all steps</button>}
          <button disabled={busy} onClick={() => setModal({ title: "Delete task and its steps?", body: "Calendar blocks are kept but detached from this task.", confirmLabel: "Delete", danger: true, onConfirm: () => perform(() => deleteTask(task.id)) })} className="min-h-11 border border-danger px-3 text-xs text-danger">Delete</button>
        </div>
      </details>
    </li>;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header><h2 className="cursor font-bold">Tasks</h2><p className="mt-2 text-sm text-ink-dim">Capture an outcome, choose its priority, then give it time on the calendar.</p></header>
      <form className="panel space-y-3 p-4" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await addTask({ title, kind, est_min: estimate, priority, due: due || null, project_id: project ? Number(project) : null });
          setTitle("");
        });
      }}>
        <label className="block text-sm">New task
          <input required aria-label="New task" disabled={busy} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" className="mt-2 w-full border border-edge bg-panel-2 p-3" />
        </label>
        <details>
          <summary className="text-sm text-ink-dim">Priority, deadline & project</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="text-xs">Priority<select aria-label="New task priority" value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="mt-1 block w-full border border-edge bg-panel-2 p-2"><option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option></select></label>
            <label className="text-xs">Due date<input aria-label="New task due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="mt-1 block w-full border border-edge bg-panel-2 p-2" /></label>
            <label className="text-xs">Minutes<input aria-label="Estimated minutes" type="number" min={5} required value={estimate} onChange={(e) => setEstimate(Number(e.target.value))} className="mt-1 block w-full border border-edge bg-panel-2 p-2" /></label>
            <label className="text-xs">Project<select aria-label="New task project" value={project} onChange={(e) => setProject(e.target.value)} className="mt-1 block w-full border border-edge bg-panel-2 p-2"><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="text-xs">Category<select aria-label="New task category" value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 block w-full border border-edge bg-panel-2 p-2">{TASK_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
          </div>
        </details>
        <button disabled={busy} className="btn-px bg-accent px-4 py-2 font-bold text-black">{busy ? "Saving..." : "Add task"}</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <TaskViews query={query} change={setQuery} projects={projects} />
      {loading && <p role="status">Loading tasks...</p>}
      {!loading && !visible.length && <p className="panel p-5 text-sm text-ink-dim">No tasks in this view.</p>}
      <ul className="space-y-3">{roots.map((task) => renderTask(task))}</ul>
      {breakdown && <BreakdownDialog task={breakdown} tasks={tasks} apply={(steps) => perform(() => addTaskSteps(breakdown.id, steps))} close={() => setBreakdown(null)} />}
      <ScheduleDialog task={scheduling} close={() => setScheduling(null)} done={() => void load()} />
      <Modal req={modal} close={() => setModal(null)} />
    </div>
  );
}
