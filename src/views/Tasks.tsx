import { useCallback, useEffect, useRef, useState } from "react";
import { breakdownTask, todayStr, type Project, type Task } from "../lib/api";
import { addTask, deleteTask, listProjects, listTasks, updateTask } from "../lib/data";
import ScheduleDialog from "../components/ScheduleDialog";
import Modal, { type ModalRequest } from "../components/Modal";

const KINDS = ["code", "study", "deen", "freelance", "school", "other"];

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("other");
  const [estimate, setEstimate] = useState(25);
  const [priority, setPriority] = useState(2);
  const [due, setDue] = useState("");
  const [project, setProject] = useState("");
  const [filter, setFilter] = useState("open");
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const [modal, setModal] = useState<ModalRequest | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const actionLock = useRef(false);

  const load = useCallback(async () => {
    try {
      const [all, ps] = await Promise.all([listTasks(), listProjects()]);
      setTasks(all); setProjects(ps);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener("focus", load);
    window.addEventListener("mizan:data-changed", load);
    return () => { window.removeEventListener("focus", load); window.removeEventListener("mizan:data-changed", load); };
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true); setError("");
    try { await action(); await load(); }
    catch (e) { setError(String(e)); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const saveTitle = (task: Task) => run(async () => {
    await updateTask(task.id, { title: editText.trim() });
    setEditing(null);
  });
  const visible = tasks.filter((task) =>
    filter === "all" || (filter === "done" ? task.status === "done" :
      task.status !== "done" && (filter === "important" ? task.priority === 1 :
        filter === "due" ? !!task.due && task.due <= todayStr() : true)),
  ).sort((a, b) => a.priority - b.priority || (a.due || "9999").localeCompare(b.due || "9999"));

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
            <label className="text-xs">Category<select aria-label="New task category" value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 block w-full border border-edge bg-panel-2 p-2">{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
          </div>
        </details>
        <button disabled={busy} className="btn-px bg-accent px-4 py-2 font-bold text-black">{busy ? "Saving..." : "Add task"}</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Task filters">
        {["open", "important", "due", "done", "all"].map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={`border px-3 py-2 text-sm ${filter === f ? "border-accent text-accent" : "border-edge text-ink-dim"}`}>{f === "due" ? "Due / overdue" : f}</button>)}
      </div>
      {loading && <p role="status">Loading tasks...</p>}
      {!loading && !visible.length && <p className="panel p-5 text-sm text-ink-dim">No tasks in this view.</p>}
      <ul className="space-y-3">
        {visible.map((task) => <li key={task.id} className="panel p-4">
          <div className="flex items-start gap-3">
            <input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.status === "done"} disabled={busy} onChange={(e) => void run(() => updateTask(task.id, { status: e.target.checked ? "done" : "open" }))} className="mt-2 h-4 w-4 shrink-0" />
            {editing === task.id ?
              <input aria-label="Edit task title" autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} onBlur={() => void saveTitle(task)} onKeyDown={(e) => {
                if (e.key === "Enter") void saveTitle(task);
                if (e.key === "Escape") setEditing(null);
              }} className="min-w-0 flex-1 border border-accent bg-panel-2 p-2 text-sm" /> :
              <button onClick={() => { setEditing(task.id); setEditText(task.title); }} className={`min-w-0 flex-1 break-words text-left text-sm ${task.status === "done" ? "line-through text-ink-dim" : ""}`}>{task.title}</button>}
            <button disabled={busy || task.status === "done"} onClick={() => setScheduling(task)} className="shrink-0 border border-edge px-3 py-1 text-xs">Schedule</button>
          </div>
          <p className="mt-2 text-xs text-ink-dim">{task.priority === 1 ? "Important · " : ""}{task.est_min} min{task.due ? ` · Due ${task.due}` : ""}{task.parent_id !== null ? " · Subtask" : ""}{task.project_id !== null ? ` · ${projects.find((p) => p.id === task.project_id)?.name ?? "Project"}` : ""}</p>
          <details className="mt-2">
            <summary className="text-xs text-ink-dim">Edit details</summary>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="text-xs">Priority<select aria-label={`Priority for ${task.title}`} disabled={busy} value={task.priority} onChange={(e) => void run(() => updateTask(task.id, { priority: Number(e.target.value) }))} className="mt-1 block border border-edge bg-panel-2 p-2"><option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option></select></label>
              <label className="text-xs">Due date<input aria-label={`Due date for ${task.title}`} disabled={busy} type="date" value={task.due ?? ""} onChange={(e) => void run(() => updateTask(task.id, { due: e.target.value || null }))} className="mt-1 block border border-edge bg-panel-2 p-2" /></label>
              <button disabled={busy || tasks.some((t) => t.parent_id === task.id)} onClick={() => void run(async () => {
                const steps = await breakdownTask(task.title, task.kind, false);
                for (const step of steps) await addTask({ title: step, kind: task.kind, parent_id: task.id, project_id: task.project_id, priority: task.priority, due: task.due });
              })} className="border border-edge px-3 py-2 text-xs">Break into steps</button>
              <button disabled={busy} onClick={() => setModal({ title: "Delete task and its subtasks?", body: "Calendar blocks are kept but detached from this task.", confirmLabel: "Delete", danger: true, onConfirm: async () => { await deleteTask(task.id); await load(); } })} className="border border-danger px-3 py-2 text-xs text-danger">Delete</button>
            </div>
          </details>
        </li>)}
      </ul>
      <ScheduleDialog task={scheduling} close={() => setScheduling(null)} done={() => void load()} />
      <Modal req={modal} close={() => setModal(null)} />
    </div>
  );
}
