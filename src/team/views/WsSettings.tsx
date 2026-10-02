// Workspace settings: details, projects, copying a personal project in, sync, export, leave.
import { useEffect, useState } from "react";
import { listProjects, listTasks } from "../../lib/data";
import type { Project as PersonalProject } from "../../lib/api";
import { create, set, team } from "../api";
import { can, suggestKey, type OpInput, type Project } from "../model";
import { initialRanks } from "../rank";
import { Field, MemberSelect, ago, inputCls, inlineCls, useWs } from "./ui";
import { useNavigate } from "react-router-dom";

const SWATCHES = ["#60a5fa", "#34d399", "#f472b6", "#eab308", "#a78bfa", "#f97316", "#22d3ee"];
const STATUS_MAP: Record<string, string> = { backlog: "backlog", open: "todo", doing: "in_progress", done: "done" };
const PRIORITY_MAP: Record<number, number> = { 1: 2, 2: 3, 3: 4 };

function ProjectForm({ project, close }: { project?: Project; close: () => void }) {
  const { model, run } = useWs();
  const [name, setName] = useState(project?.name ?? "");
  const [key, setKey] = useState(project?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(!!project);
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color ?? SWATCHES[model.projects.length % SWATCHES.length]);
  const [lead, setLead] = useState<string | null>(project?.lead ?? model.me);
  const [target, setTarget] = useState(project?.target ?? "");
  const [error, setError] = useState("");
  const shownKey = keyTouched ? key : suggestKey(name);
  const save = async () => {
    const k = shownKey.trim().toUpperCase();
    if (!name.trim()) return setError("Name the project.");
    if (!/^[A-Z][A-Z0-9]{1,7}$/.test(k)) return setError("The key is 2-8 capital letters or digits, starting with a letter.");
    if (model.projects.some((p) => p.key === k && p.id !== project?.id)) return setError(`Another project already uses ${k}.`);
    const fields = { name: name.trim(), description, color, lead, target: target || null };
    const ok = await run([project ? set("project", project.id, fields) : create("project", { ...fields, key: k, status: "active", created_at: new Date().toISOString() })]);
    if (ok) close();
  };
  return (
    <div className="grid gap-3 border border-edge bg-panel-2 p-3 sm:grid-cols-2">
      <Field label="Name"><input className={inputCls} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={project ? "Key (fixed once issues exist)" : "Key (prefix for issue numbers)"}>
        <input className={inputCls} value={shownKey} disabled={!!project} maxLength={8} onChange={(e) => { setKeyTouched(true); setKey(e.target.value.toUpperCase()); }} />
      </Field>
      <Field label="Lead (runs sprints)"><MemberSelect model={model} value={lead} onChange={setLead} label="Lead" empty="No lead" /></Field>
      <Field label="Target date"><input type="date" className={inputCls} value={target?.slice(0, 10) ?? ""} onChange={(e) => setTarget(e.target.value)} /></Field>
      <Field label="Description"><textarea className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Colour">
        <span className="flex gap-1.5">{SWATCHES.map((c) => <button type="button" key={c} aria-label={`Colour ${c}`} onClick={() => setColor(c)} className="h-6 w-6" style={{ background: c, outline: c === color ? "2px solid white" : undefined }} />)}</span>
      </Field>
      {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-px bg-accent px-3 py-1.5 text-sm font-semibold text-black" onClick={save}>{project ? "Save project" : "Create project"}</button>
        <button className="border border-edge px-3 py-1.5 text-sm" onClick={close}>Cancel</button>
      </div>
    </div>
  );
}

function CopyPersonal() {
  const { model, run } = useWs();
  const [projects, setProjects] = useState<PersonalProject[]>([]);
  const [pick, setPick] = useState("");
  const [key, setKey] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { listProjects().then(setProjects).catch(() => setProjects([])); }, []);
  if (!projects.length) return null;
  const chosen = projects.find((p) => String(p.id) === pick);
  const copy = async () => {
    if (!chosen) return;
    const k = (key || suggestKey(chosen.name)).toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,7}$/.test(k) || model.projects.some((p) => p.key === k)) { setNote(`Choose a free key (2-8 capitals). ${k} is taken or invalid.`); return; }
    const tasks = (await listTasks()).filter((t) => t.project_id === chosen.id);
    const top = tasks.filter((t) => t.parent_id === null);
    const ranks = initialRanks(top.length);
    const projectOp = create("project", { name: chosen.name, key: k, description: chosen.goal ?? "", color: chosen.color || SWATCHES[0], lead: model.me, status: "active", target: chosen.due, created_at: new Date().toISOString() });
    const ops: OpInput[] = [projectOp];
    top.forEach((t, i) => {
      const steps = tasks.filter((s) => s.parent_id === t.id).map((s) => ({ text: s.title.slice(0, 300), done: s.status === "done" }));
      const status = STATUS_MAP[t.status] ?? "todo";
      ops.push(create("issue", {
        project_id: projectOp.id, title: t.title.slice(0, 300) || "(untitled)", description: t.notes ?? "", type: "task", status,
        priority: PRIORITY_MAP[t.priority] ?? 0, assignee: null, estimate: model.workspace.estimate_unit === "hours" && t.est_min ? Math.round((t.est_min / 60) * 10) / 10 : null,
        due: t.due, labels: [], checklist: steps.slice(0, 200), parent_id: null, sprint_id: null, rank: ranks[i],
        resolved_at: status === "done" ? (t.completed_at ?? new Date().toISOString()) : null, created_at: new Date().toISOString(),
      }));
    });
    for (let i = 0; i < ops.length; i += 400) if (!(await run(ops.slice(i, i + 400)))) return;
    setNote(`Copied ${top.length} tasks into ${k}. Your personal project is unchanged.`);
    setPick("");
  };
  return (
    <section className="space-y-2 border border-edge bg-panel p-4">
      <h3 className="font-bold">Copy a personal project in</h3>
      <p className="text-xs text-ink-dim">A one-time copy: tasks become issues, subtasks become checklist items. Your personal data stays private and is not linked.</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Personal project" className={`${inlineCls} w-auto`} value={pick} onChange={(e) => { setPick(e.target.value); setKey(""); setNote(""); }}>
          <option value="">Choose…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {chosen && <input aria-label="New project key" className={`${inlineCls} w-24`} value={key || suggestKey(chosen.name)} maxLength={8} onChange={(e) => setKey(e.target.value.toUpperCase())} />}
        <button disabled={!chosen} className="border border-edge px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50" onClick={copy}>Copy</button>
      </div>
      {note && <p role="status" className="text-sm text-ink-dim">{note}</p>}
    </section>
  );
}

export default function WsSettings() {
  const { ws, model, run, ask } = useWs();
  const nav = useNavigate();
  const admin = can(model, "workspace-settings");
  const [name, setName] = useState(model.workspace.name);
  const [description, setDescription] = useState(model.workspace.description);
  const [form, setForm] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const s = model.summary;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="space-y-3 border border-edge bg-panel p-4">
        <h3 className="font-bold">Workspace</h3>
        <Field label="Name"><input disabled={!admin} className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><textarea disabled={!admin} className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!admin} checked={model.workspace.members_create_projects} onChange={(e) => void run([set("workspace", "ws", { members_create_projects: e.target.checked })])} /> Members can create projects</label>
        <Field label="Estimate in">
          <select disabled={!admin} className={`${inlineCls} w-auto`} value={model.workspace.estimate_unit} onChange={(e) => void run([set("workspace", "ws", { estimate_unit: e.target.value })])}>
            <option value="points">Story points</option><option value="hours">Hours</option>
          </select>
        </Field>
        {admin && <button className="btn-px bg-accent px-3 py-1.5 text-sm font-semibold text-black" onClick={() => void run([set("workspace", "ws", { name: name.trim() || model.workspace.name, description })])}>Save</button>}
      </section>

      <section className="space-y-3 border border-edge bg-panel p-4">
        <h3 className="font-bold">Sync</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-dim">This device</dt><dd>{s.mode === "host" ? "Hosts the workspace (source of truth)" : "Replica of a teammate's host"}</dd>
          {s.mode === "replica" && <><dt className="text-ink-dim">Host</dt><dd className="break-all">{s.host || "—"}</dd></>}
          {s.mode === "replica" && <><dt className="text-ink-dim">Last sync</dt><dd>{s.last_sync ? ago(s.last_sync) : "never"}</dd></>}
          <dt className="text-ink-dim">Waiting to send</dt><dd>{model.pending}</dd>
          <dt className="text-ink-dim">Your role</dt><dd>{model.role}</dd>
        </dl>
        {s.error && <p role="alert" className="text-sm text-danger">{s.error}</p>}
        <div className="flex flex-wrap gap-2">
          {s.mode === "replica" && <button className="border border-edge px-3 py-1.5 text-sm hover:border-accent" onClick={() => team.sync(ws).then((r) => setNote(r.error ? r.error : "Synced.")).catch((e) => setNote(String(e)))}>Sync now</button>}
          <button className="border border-edge px-3 py-1.5 text-sm hover:border-accent" onClick={() => team.exportJson(ws).then((p) => setNote(`Exported to ${p}`)).catch((e) => setNote(String(e)))}>Export JSON</button>
          <button className="border border-danger/50 px-3 py-1.5 text-sm text-danger hover:border-danger" onClick={() => ask({
            title: s.mode === "host" ? "Delete this workspace from this computer?" : "Leave this workspace on this device?",
            body: s.mode === "host" ? "This computer is the host. Deleting removes the only full copy: export first. Teammates' devices stop syncing." : "Removes the local copy. Unsent changes are lost. You need a new invite to come back.",
            confirmLabel: s.mode === "host" ? "Delete workspace" : "Leave", danger: true,
            input: s.mode === "host" ? { placeholder: `Type ${model.workspace.name} to confirm`, minLen: 1 } : undefined,
            onConfirm: async (typed) => {
              if (s.mode === "host" && typed !== model.workspace.name) throw new Error("The name does not match.");
              await team.remove(ws);
              nav("/team");
            },
          })}>{s.mode === "host" ? "Delete workspace" : "Leave workspace"}</button>
        </div>
        {note && <p role="status" className="text-sm text-ink-dim">{note}</p>}
      </section>

      <section className="space-y-3 border border-edge bg-panel p-4 xl:col-span-2">
        <div className="flex items-center gap-2">
          <h3 className="font-bold">Projects</h3>
          {can(model, "create-project") && <button className="ml-auto border border-edge px-3 py-1 text-sm hover:border-accent" onClick={() => setForm(form === "new" ? null : "new")}>+ Project</button>}
        </div>
        {form === "new" && <ProjectForm close={() => setForm(null)} />}
        <ul className="divide-y divide-edge/60">
          {model.projects.map((p) => (
            <li key={p.id} className="py-2">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="h-3 w-3" style={{ background: p.color }} />
                <span className="w-14 font-bold">{p.key}</span>
                <span className="flex-1">{p.name}{p.status === "archived" && <span className="ml-2 text-xs text-ink-dim">archived</span>}</span>
                <span className="text-xs text-ink-dim">{model.issues.filter((i) => i.project_id === p.id).length} issues · lead {model.members.get(p.lead ?? "")?.name ?? "none"}</span>
                {can(model, "edit-project", { projectId: p.id }) && <>
                  <button className="border border-edge px-2 py-0.5 text-xs" onClick={() => setForm(form === p.id ? null : p.id)}>Edit</button>
                  <button className="border border-edge px-2 py-0.5 text-xs" onClick={() => void run([set("project", p.id, { status: p.status === "archived" ? "active" : "archived" })])}>{p.status === "archived" ? "Restore" : "Archive"}</button>
                </>}
              </div>
              {form === p.id && <div className="mt-2"><ProjectForm project={p} close={() => setForm(null)} /></div>}
            </li>
          ))}
        </ul>
      </section>
      {can(model, "create-project") && <div className="xl:col-span-2"><CopyPersonal /></div>}
    </div>
  );
}
