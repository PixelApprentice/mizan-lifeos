// Shared pieces for the team views.
import { createContext, useContext, useState, type ReactNode } from "react";
import type { ModalRequest } from "../../components/Modal";
import { useDialogFocus } from "../../components/useDialogFocus";
import { create } from "../api";
import { ISSUE_TYPES, PRIORITIES, STATUSES, can, priorityOf, typeOf, type Issue, type IssueType, type Model, type OpInput, type StatusId } from "../model";
import { rankBetween } from "../rank";

export interface WsCtx {
  ws: string;
  model: Model;
  /** Selected project id, or "" for all projects. */
  project: string;
  setProject: (id: string) => void;
  /** Submit edits; shows the host's refusal as an error banner. */
  run: (ops: OpInput[]) => Promise<boolean>;
  openIssue: (id: string) => void;
  newIssue: (preset?: Partial<Issue>) => void;
  ask: (req: ModalRequest) => void;
}
export const Ctx = createContext<WsCtx | null>(null);
export function useWs(): WsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("Team view outside a workspace.");
  return v;
}

export function Avatar({ model, id, size = 20 }: { model: Model; id: string | null; size?: number }) {
  const m = id ? model.members.get(id) : undefined;
  const name = m?.name ?? (id ? "?" : "");
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span
      title={m ? m.name : id ? "Former member" : "Unassigned"}
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-black"
      style={{ width: size, height: size, background: m?.color ?? "transparent", border: id ? undefined : "1px dashed var(--color-edge)" }}
    >
      {initials}
    </span>
  );
}

export function PriorityMark({ value }: { value: number }) {
  const p = priorityOf(value);
  return <span title={p.label} aria-label={`Priority ${p.label}`} className="inline-block w-4 text-center text-xs font-bold" style={{ color: p.color }}>{p.mark}</span>;
}

export function TypeMark({ type }: { type: string }) {
  const t = typeOf(type);
  return <span title={t.label} className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: t.color, borderRadius: type === "bug" ? "50%" : type === "epic" ? "0" : "2px", transform: type === "story" ? "rotate(45deg) scale(.8)" : undefined }} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-dim">
      <span>{label}</span>
      {children}
    </label>
  );
}

export const inlineCls = "border border-edge bg-panel-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-60";
export const inputCls = `w-full ${inlineCls}`;

export function StatusSelect({ value, onChange, disabled, label = "Status" }: { value: string; onChange: (s: StatusId) => void; disabled?: boolean; label?: string }) {
  return (
    <select aria-label={label} disabled={disabled} className={inputCls} value={value} onChange={(e) => onChange(e.target.value as StatusId)}>
      {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );
}

export function MemberSelect({ model, value, onChange, disabled, label = "Assignee", empty = "Unassigned" }: { model: Model; value: string | null; onChange: (id: string | null) => void; disabled?: boolean; label?: string; empty?: string }) {
  const people = [...model.members.values()].filter((m) => m.active || m.id === value).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select aria-label={label} disabled={disabled} className={inputCls} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{empty}</option>
      {people.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === model.me ? " (you)" : ""}</option>)}
    </select>
  );
}

/** Dialog for a new issue. The host assigns the number (WEB-12). */
export function NewIssueDialog({ preset, close }: { preset: Partial<Issue>; close: () => void }) {
  const { model, run, project } = useWs();
  const projects = model.projects.filter((p) => p.status === "active");
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(preset.project_id || project || projects[0]?.id || "");
  const [type, setType] = useState<IssueType>(preset.type ?? "task");
  const [status, setStatus] = useState<StatusId>(preset.status ?? "todo");
  const [priority, setPriority] = useState(preset.priority ?? 0);
  const [assignee, setAssignee] = useState<string | null>(preset.assignee ?? null);
  const [estimate, setEstimate] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useDialogFocus(true);
  const sprintId = preset.sprint_id ?? null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError("Give the issue a title."); return; }
    if (!projectId) { setError("Create a project first (Settings → Projects)."); return; }
    const est = estimate.trim() === "" ? null : Number(estimate);
    if (est !== null && !(est >= 0 && est <= 10000)) { setError("Estimate must be a number from 0 to 10000."); return; }
    const inProject = model.issues.filter((i) => i.project_id === projectId);
    const last = inProject[inProject.length - 1]?.rank ?? null;
    setBusy(true);
    const ok = await run([create("issue", {
      project_id: projectId, title: title.trim(), type, status, priority, assignee, estimate: est, description: description.trim(),
      sprint_id: sprintId, rank: rankBetween(last, null), labels: [], checklist: [], due: null, parent_id: preset.parent_id ?? null,
      resolved_at: null, created_at: new Date().toISOString(),
    })]);
    setBusy(false);
    if (ok) close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={close} onKeyDown={(e) => e.key === "Escape" && close()}>
      <div ref={ref} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="new-issue-title" className="panel w-[min(560px,94vw)] bg-panel p-5">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h3 id="new-issue-title" className="font-bold text-accent">New issue{sprintId ? " in sprint" : ""}</h3>
        <input aria-label="Title" placeholder="What needs doing?" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
        <textarea aria-label="Description" placeholder="Details (optional)" className={`${inputCls} min-h-20`} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Project">
            <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as IssueType)}>
              {ISSUE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Status"><StatusSelect value={status} onChange={setStatus} /></Field>
          <Field label="Priority">
            <select className={inputCls} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Assignee"><MemberSelect model={model} value={assignee} onChange={setAssignee} /></Field>
          <Field label={model.workspace.estimate_unit === "hours" ? "Estimate (hours)" : "Estimate (points)"}>
            <input inputMode="decimal" className={inputCls} value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="—" />
          </Field>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {!can(model, "edit-issues") && <p className="text-sm text-danger">Viewers cannot create issues.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="border border-edge px-4 py-2 text-sm text-ink-dim">Cancel</button>
          <button disabled={busy || !can(model, "edit-issues")} className="btn-px bg-accent px-4 py-2 text-sm font-semibold text-black">{busy ? "Saving…" : "Create issue"}</button>
        </div>
      </form>
      </div>
    </div>
  );
}

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

export function Empty({ children }: { children: ReactNode }) {
  return <p className="border border-dashed border-edge p-6 text-center text-sm text-ink-dim">{children}</p>;
}
