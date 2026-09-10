import { useEffect, useRef, useState } from "react";
import { appendToLog, dayInfo, ensureDayLog, todayStr, type Project } from "../lib/api";
import { addTask, listProjects } from "../lib/data";
import { flushBeforeExit } from "../lib/unsaved";
import { useDialogFocus } from "./useDialogFocus";

export default function QuickCapture({ open, close, saved }: { open: boolean; close: () => void; saved: (message: string) => void }) {
  const [target, setTarget] = useState("task");
  const [text, setText] = useState("");
  const [date, setDate] = useState(todayStr());
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState(2);
  const [estimate, setEstimate] = useState(25);
  const [project, setProject] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const lock = useRef(false);
  const initialized = useRef(false);
  const ref = useDialogFocus(open);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(""); setLoading(true);
    Promise.all([listProjects(), dayInfo()]).then(([items, info]) => {
      if (!alive) return;
      setProjects(items);
      if (!initialized.current) {
        setDate(info.day < 1 ? info.day1 : todayStr());
        initialized.current = true;
      }
    }).catch((e) => { if (alive) setError(String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;
  const submit = async () => {
    if (lock.current) return;
    if (!text.trim()) { setError("Write something to capture."); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      if (target === "task") {
        await addTask({ title: text.trim(), kind: "other", est_min: estimate, priority, due: due || null, project_id: project ? Number(project) : null });
      } else {
        await flushBeforeExit();
        await ensureDayLog(date);
        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        await appendToLog(date, `- ${time}: ${text.trim().replace(/\n/g, "\n  ")}`);
        window.dispatchEvent(new CustomEvent("mizan:log-appended", { detail: date }));
      }
      setText("");
      saved(target === "task" ? "Task captured. Find it in Tasks or your project." : `Note appended to ${date}. Your existing log was kept.`);
      close();
    } catch (e) { setError(String(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => { if (!busy) close(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Quick capture" className="panel max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape" && !busy) close(); }}>
        <h3 className="font-bold">Quick capture</h3>
        <p className="text-xs text-ink-dim">Capture without leaving this view. Closing keeps this draft until you exit the app.</p>
        {loading && <p role="status" className="text-sm">Loading local destinations...</p>}
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4">
          <fieldset disabled={busy || loading} className="space-y-3">
            <label className="block text-sm">Destination
              <select aria-label="Capture destination" value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 block w-full border border-edge bg-panel-2 p-2">
                <option value="task">Task inbox</option><option value="log">Daily log</option>
              </select>
            </label>
            <label className="block text-sm">{target === "task" ? "Task" : "Note"}
              <textarea aria-label="Capture text" required value={text} onChange={(e) => setText(e.target.value)} rows={3} className="mt-1 w-full resize-y border border-edge bg-panel-2 p-3" />
            </label>
            {target === "log" ? <label className="block text-sm">Log date<input aria-label="Capture log date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 block border border-edge bg-panel-2 p-2" /></label> :
              <details><summary className="text-xs text-ink-dim">Priority, due date & project</summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  <label className="text-xs">Priority<select aria-label="Capture priority" value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="mt-1 block w-full border border-edge bg-panel-2 p-2"><option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option></select></label>
                  <label className="text-xs">Due date<input aria-label="Capture due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="mt-1 block w-full border border-edge bg-panel-2 p-2" /></label>
                  <label className="text-xs">Project<select aria-label="Capture project" value={project} onChange={(e) => setProject(e.target.value)} className="mt-1 block w-full border border-edge bg-panel-2 p-2"><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  <label className="text-xs">Minutes<input aria-label="Capture minutes" type="number" min={5} required value={estimate} onChange={(e) => setEstimate(Number(e.target.value))} className="mt-1 block w-full border border-edge bg-panel-2 p-2" /></label>
                </div>
              </details>}
          </fieldset>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={close} className="border border-edge px-3 py-2 text-sm">Close</button>
            <button disabled={busy || loading} className="btn-px bg-accent px-4 py-2 text-sm font-bold text-black">{busy ? "Saving..." : "Capture"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
