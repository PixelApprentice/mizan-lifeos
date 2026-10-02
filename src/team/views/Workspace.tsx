// One team workspace: header with project picker and sync state, tabs, and the issue drawer.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Modal, { type ModalRequest } from "../../components/Modal";
import { edit, team, useWorkspace } from "../api";
import { inbox } from "../inbox";
import type { Issue, OpInput } from "../model";
import { Ctx, NewIssueDialog, ago, inlineCls, type WsCtx } from "./ui";

const Board = lazy(() => import("./Board"));
const Backlog = lazy(() => import("./Backlog"));
const IssueList = lazy(() => import("./IssueList"));
const Inbox = lazy(() => import("./Inbox"));
const Reports = lazy(() => import("./Reports"));
const People = lazy(() => import("./People"));
const WsSettings = lazy(() => import("./WsSettings"));
const IssuePanel = lazy(() => import("./IssuePanel"));

const TABS = [
  { id: "board", label: "Board" },
  { id: "backlog", label: "Backlog" },
  { id: "list", label: "Issues" },
  { id: "mine", label: "My issues" },
  { id: "inbox", label: "Inbox" },
  { id: "reports", label: "Reports" },
  { id: "people", label: "People" },
  { id: "settings", label: "Settings" },
] as const;

export default function Workspace() {
  const { ws = "", tab = "board" } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { model, error: loadError } = useWorkspace(ws);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalRequest | null>(null);
  const [creating, setCreating] = useState<Partial<Issue> | null>(null);
  const [syncing, setSyncing] = useState(false);
  const projectKey = `mizan.team.project.${ws}`;
  const [project, setProjectState] = useState(() => localStorage.getItem(projectKey) ?? "");
  const setProject = useCallback((id: string) => { setProjectState(id); localStorage.setItem(projectKey, id); }, [projectKey]);
  const issueId = params.get("issue");

  const run = useCallback(async (ops: OpInput[]) => {
    try { await edit(ws, ops); setError(""); return true; } catch (e) { setError(String(e).replace(/^Error: /, "")); return false; }
  }, [ws]);
  const openIssue = useCallback((id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("issue", id); return n; }), [setParams]);
  const closeIssue = useCallback(() => setParams((p) => { const n = new URLSearchParams(p); n.delete("issue"); return n; }), [setParams]);

  const ctx: WsCtx | null = useMemo(() => model && {
    ws, model, project: model.projectById.has(project) ? project : "", setProject, run, openIssue,
    newIssue: (preset = {}) => setCreating(preset), ask: setModal,
  }, [ws, model, project, setProject, run, openIssue]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "c" || e.ctrlKey || e.metaKey || e.altKey || issueId || creating || modal) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      setCreating({ project_id: model?.projectById.has(project) ? project : undefined });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [issueId, creating, modal, model, project]);
  const unread = useMemo(() => {
    if (!model) return 0;
    const read = Number(localStorage.getItem(`mizan.team.inbox-read.${ws}`) ?? 0);
    return inbox(model).filter((i) => i.seq > read).length;
  }, [model, ws, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) return (
    <div className="space-y-3">
      <p role="alert" className="text-danger">This workspace could not be opened: {loadError}</p>
      <button className="border border-edge px-3 py-1.5 text-sm" onClick={() => nav("/team")}>Back to workspaces</button>
    </div>
  );
  if (!model || !ctx) return <p role="status">Loading workspace…</p>;

  const s = model.summary;
  const syncLabel = s.mode === "host" ? "Hosting" : s.error ? "Offline" : model.pending ? `${model.pending} to send` : s.last_sync ? `Synced ${ago(s.last_sync)}` : "Connecting…";
  const syncNow = async () => {
    setSyncing(true);
    try { const r = await team.sync(ws); setError(r.error || ""); } catch (e) { setError(String(e)); } finally { setSyncing(false); }
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="hd text-lg">{model.workspace.name}</h1>
          <select aria-label="Project" className={`${inlineCls} w-auto`} value={ctx.project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All projects</option>
            {model.projects.filter((p) => p.status === "active").map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
          </select>
          <button onClick={() => setCreating({ project_id: ctx.project || undefined })} className="btn-px bg-accent px-3 py-1.5 text-sm font-semibold text-black" title="New issue (C)">+ Issue</button>
          <span className="ml-auto flex items-center gap-2 text-xs text-ink-dim">
            <span className={`inline-block h-2 w-2 rounded-full ${s.mode === "host" ? "bg-accent" : s.error ? "bg-danger" : model.pending ? "bg-gold" : "bg-accent"}`} />
            <span title={s.error || undefined}>{syncLabel}</span>
            {s.mode === "replica" && <button disabled={syncing} className="border border-edge px-2 py-0.5 hover:border-accent" onClick={syncNow}>{syncing ? "…" : "Sync"}</button>}
            <span>· {model.role}</span>
          </span>
        </header>
        <nav aria-label="Workspace sections" className="flex gap-1 overflow-x-auto border-b border-edge text-sm">
          {TABS.map((t) => (
            <NavLink key={t.id} to={`/team/${ws}/${t.id}`} className={({ isActive }) => `whitespace-nowrap border-b-2 px-3 py-1.5 ${isActive || (t.id === "board" && !tab) ? "border-accent text-accent" : "border-transparent text-ink-dim hover:text-ink"}`}>
              {t.label}{t.id === "inbox" && unread > 0 && <span className="ml-1 bg-accent px-1 text-[10px] text-black">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        {error && <div role="alert" className="flex items-center gap-3 border border-danger p-2 text-sm text-danger">{error}<button className="ml-auto" onClick={() => setError("")} aria-label="Dismiss error">Dismiss</button></div>}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <Suspense fallback={<p role="status">Loading…</p>}>
            {tab === "board" && <Board />}
            {tab === "backlog" && <Backlog />}
            {tab === "list" && <IssueList />}
            {tab === "mine" && <IssueList mine />}
            {tab === "inbox" && <Inbox />}
            {tab === "reports" && <Reports />}
            {tab === "people" && <People />}
            {tab === "settings" && <WsSettings />}
            {!TABS.some((t) => t.id === tab) && <p>Unknown section.</p>}
          </Suspense>
        </div>
      </div>
      {issueId && <Suspense fallback={null}><IssuePanel id={issueId} close={closeIssue} /></Suspense>}
      {creating && <NewIssueDialog preset={creating} close={() => setCreating(null)} />}
      <Modal req={modal} close={() => setModal(null)} />
    </Ctx.Provider>
  );
}
