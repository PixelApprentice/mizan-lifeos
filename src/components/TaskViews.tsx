import { useEffect, useState } from "react";
import type { Project } from "../lib/api";
import { DEFAULT_QUERY, type SavedTaskView, type TaskQuery } from "../lib/workflows";
import { deleteTaskView, listTaskViews, saveTaskView } from "../lib/workflowStore";
import Modal, { type ModalRequest } from "./Modal";

export default function TaskViews({ query, change, projects }: { query: TaskQuery; change: (query: TaskQuery) => void; projects: Project[] }) {
  const [views, setViews] = useState<SavedTaskView[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalRequest | null>(null);
  useEffect(() => {
    let alive = true;
    listTaskViews().then((items) => { if (alive) setViews(items); })
      .catch((e) => { if (alive) setError(String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const patch = (value: Partial<TaskQuery>) => { setSelected(""); change({ ...query, ...value }); };
  return <section aria-label="Task views" className="space-y-3">
    <label className="block text-sm">Search tasks<input aria-label="Search tasks" type="search" value={query.text} onChange={(e) => patch({ text: e.target.value })} placeholder="Search titles and notes" className="mt-1 block w-full border border-edge bg-panel p-2" /></label>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Task filters">
      {(["open", "important", "due", "done", "all"] as const).map((scope) => <button key={scope} aria-pressed={query.scope === scope} onClick={() => patch({ scope })} className={`border px-3 py-2 text-sm ${query.scope === scope ? "border-accent text-accent" : "border-edge text-ink-dim"}`}>{scope === "due" ? "Due / overdue" : scope}</button>)}
    </div>
    <details className="panel p-3">
      <summary className="text-sm">Filters & saved views{query.project !== "all" || query.kind !== "all" || query.deadline !== "any" || query.sort !== "priority" ? " · customized" : ""}</summary>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs">Project<select aria-label="Filter project" value={query.project} onChange={(e) => patch({ project: e.target.value })} className="mt-1 block w-full border border-edge bg-panel-2 p-2"><option value="all">All projects</option><option value="none">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="text-xs">Category<select aria-label="Filter category" value={query.kind} onChange={(e) => patch({ kind: e.target.value })} className="mt-1 block w-full border border-edge bg-panel-2 p-2">{["all", "code", "study", "deen", "freelance", "school", "other"].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label className="text-xs">Deadline<select aria-label="Filter deadline" value={query.deadline} onChange={(e) => { const deadline = e.target.value; if (deadline === "any" || deadline === "overdue" || deadline === "today" || deadline === "next7" || deadline === "none") patch({ deadline }); }} className="mt-1 block w-full border border-edge bg-panel-2 p-2"><option value="any">Any date</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="next7">Next 7 days</option><option value="none">No due date</option></select></label>
        <label className="text-xs">Sort<select aria-label="Sort tasks" value={query.sort} onChange={(e) => { const sort = e.target.value; if (sort === "priority" || sort === "due" || sort === "title") patch({ sort }); }} className="mt-1 block w-full border border-edge bg-panel-2 p-2"><option value="priority">Priority</option><option value="due">Due date</option><option value="title">Title</option></select></label>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs">Saved view<select aria-label="Saved task view" disabled={loading} value={selected} onChange={(e) => {
          const view = views.find((item) => item.id === e.target.value);
          setSelected(e.target.value); change(view ? { ...view.query } : { ...DEFAULT_QUERY });
        }} className="mt-1 block w-full border border-edge bg-panel-2 p-2"><option value="">Custom / default view</option>{views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
        <button disabled={loading} onClick={() => setModal({ title: "Save task view", body: "Relative deadlines update each day. This saves filters, not copies of tasks.", input: { placeholder: "View name" }, confirmLabel: "Save view", onConfirm: async (name) => {
          const view = { id: crypto.randomUUID(), name, query: { ...query } };
          await saveTaskView(view); setViews((items) => [...items, view]); setSelected(view.id);
        } })} className="border border-edge px-3 py-2 text-xs">Save view</button>
        <button onClick={() => { setSelected(""); change({ ...DEFAULT_QUERY }); }} className="border border-edge px-3 py-2 text-xs">Reset filters</button>
        {selected && <button onClick={() => setModal({ title: "Delete saved view?", body: "Tasks and their schedules are kept.", confirmLabel: "Delete view", danger: true, onConfirm: async () => {
          await deleteTaskView(selected); setViews((items) => items.filter((item) => item.id !== selected)); setSelected("");
        } })} className="border border-danger px-3 py-2 text-xs text-danger">Delete view</button>}
      </div>
      {loading && <p role="status" className="mt-2 text-xs">Loading saved views...</p>}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </details>
    <Modal req={modal} close={() => setModal(null)} />
  </section>;
}
