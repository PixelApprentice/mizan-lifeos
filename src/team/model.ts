// Team data model on the client: typed views over the rows the host merged, plus the same
// permission rules the host enforces (used here only to hide controls).
import { byRank } from "./rank.ts";

export type Role = "owner" | "admin" | "member" | "viewer";
export type StatusId = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type IssueType = "epic" | "story" | "task" | "bug";

export interface TeamRow { entity: string; id: string; data: Record<string, unknown> }
export interface TeamOp {
  seq: number; op_id: string; member: string; hlc: string; entity: string; id: string;
  kind: "create" | "set" | "delete"; fields: Record<string, unknown>; at: string;
}
export interface WorkspaceSummary {
  id: string; name: string; mode: "host" | "replica" | "broken"; me: string; role: Role;
  pending: number; last_sync: string; error: string; host: string;
}
export interface TeamState { rows: TeamRow[]; ops: TeamOp[]; pending: number; workspace: WorkspaceSummary }
export interface OpInput { entity: string; id: string; kind?: "create" | "set" | "delete"; fields?: Record<string, unknown> }

export interface Member { id: string; name: string; email?: string; role: Role; active: boolean; color: string; joined_at?: string }
export interface Project {
  id: string; key: string; name: string; description: string; color: string; lead: string | null;
  status: "active" | "archived"; target: string | null; created_at?: string; deleted?: boolean;
}
export interface ChecklistItem { text: string; done: boolean }
export interface Issue {
  id: string; project_id: string; number: number | null; type: IssueType; title: string; description: string;
  status: StatusId; priority: number; assignee: string | null; reporter: string; estimate: number | null;
  due: string | null; labels: string[]; checklist: ChecklistItem[]; parent_id: string | null; sprint_id: string | null;
  rank: string; resolved_at: string | null; created_at: string; deleted?: boolean; _pending?: boolean;
}
export interface Sprint {
  id: string; project_id: string; name: string; goal: string; start: string | null; end: string | null;
  state: "planned" | "active" | "closed"; closed_at: string | null; created_at?: string; deleted?: boolean;
}
export interface Comment { id: string; issue_id: string; body: string; author: string; created_at: string; edited_at: string | null; deleted?: boolean; _pending?: boolean }
export interface Worklog { id: string; issue_id: string; member: string; minutes: number; date: string; note: string; created_at?: string; deleted?: boolean }

export const STATUSES: { id: StatusId; label: string; category: "todo" | "doing" | "done" | "canceled" }[] = [
  { id: "backlog", label: "Backlog", category: "todo" },
  { id: "todo", label: "To do", category: "todo" },
  { id: "in_progress", label: "In progress", category: "doing" },
  { id: "in_review", label: "In review", category: "doing" },
  { id: "done", label: "Done", category: "done" },
  { id: "canceled", label: "Canceled", category: "canceled" },
];
export const statusLabel = (s: string) => STATUSES.find((x) => x.id === s)?.label ?? s;
export const isClosed = (s: string) => s === "done" || s === "canceled";

export const PRIORITIES = [
  { id: 1, label: "Urgent", mark: "!!", color: "#f87171" },
  { id: 2, label: "High", mark: "!", color: "#fb923c" },
  { id: 3, label: "Medium", mark: "=", color: "#eab308" },
  { id: 4, label: "Low", mark: "↓", color: "#a0a0aa" },
  { id: 0, label: "No priority", mark: "·", color: "#90909b" },
];
export const priorityOf = (n: number) => PRIORITIES.find((p) => p.id === n) ?? PRIORITIES[4];

export const ISSUE_TYPES: { id: IssueType; label: string; color: string }[] = [
  { id: "task", label: "Task", color: "#60a5fa" },
  { id: "story", label: "Story", color: "#34d399" },
  { id: "bug", label: "Bug", color: "#f87171" },
  { id: "epic", label: "Epic", color: "#a78bfa" },
];
export const typeOf = (t: string) => ISSUE_TYPES.find((x) => x.id === t) ?? ISSUE_TYPES[0];

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const optStr = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function toIssue(id: string, d: Record<string, unknown>): Issue {
  return {
    id, project_id: str(d.project_id), number: typeof d.number === "number" ? d.number : null,
    type: (str(d.type, "task") as IssueType), title: str(d.title, "(untitled)"), description: str(d.description),
    status: (str(d.status, "todo") as StatusId), priority: num(d.priority, 0), assignee: optStr(d.assignee),
    reporter: str(d.reporter), estimate: typeof d.estimate === "number" ? d.estimate : null, due: optStr(d.due),
    labels: Array.isArray(d.labels) ? d.labels.filter((l): l is string => typeof l === "string") : [],
    checklist: Array.isArray(d.checklist) ? d.checklist.filter((c): c is ChecklistItem => !!c && typeof c === "object" && typeof (c as ChecklistItem).text === "string") : [],
    parent_id: optStr(d.parent_id), sprint_id: optStr(d.sprint_id), rank: str(d.rank), resolved_at: optStr(d.resolved_at),
    created_at: str(d.created_at), deleted: d.deleted === true, _pending: d._pending === true,
  };
}

export interface Model {
  workspace: { name: string; description: string; members_create_projects: boolean; estimate_unit: "points" | "hours" };
  summary: WorkspaceSummary;
  me: string;
  role: Role;
  members: Map<string, Member>;
  projects: Project[];
  projectById: Map<string, Project>;
  issues: Issue[];
  issueById: Map<string, Issue>;
  sprints: Sprint[];
  comments: Map<string, Comment[]>;
  worklogs: Map<string, Worklog[]>;
  ops: TeamOp[];
  pending: number;
}

export function buildModel(state: TeamState): Model {
  const members = new Map<string, Member>();
  const projects: Project[] = [];
  const issues: Issue[] = [];
  const sprints: Sprint[] = [];
  const comments = new Map<string, Comment[]>();
  const worklogs = new Map<string, Worklog[]>();
  let workspace: Model["workspace"] = { name: state.workspace.name, description: "", members_create_projects: true, estimate_unit: "points" };
  for (const { entity, id, data: d } of state.rows) {
    if (entity === "workspace") workspace = { name: str(d.name, state.workspace.name), description: str(d.description), members_create_projects: d.members_create_projects !== false, estimate_unit: d.estimate_unit === "hours" ? "hours" : "points" };
    else if (entity === "member") members.set(id, { id, name: str(d.name, "Member"), email: str(d.email), role: (str(d.role, "member") as Role), active: d.active !== false, color: str(d.color, "#a0a0aa"), joined_at: str(d.joined_at) });
    else if (entity === "project" && d.deleted !== true) projects.push({ id, key: str(d.key, "?"), name: str(d.name, "Project"), description: str(d.description), color: str(d.color, "#60a5fa"), lead: optStr(d.lead), status: d.status === "archived" ? "archived" : "active", target: optStr(d.target), created_at: str(d.created_at) });
    else if (entity === "issue" && d.deleted !== true) issues.push(toIssue(id, d));
    else if (entity === "sprint" && d.deleted !== true) sprints.push({ id, project_id: str(d.project_id), name: str(d.name, "Sprint"), goal: str(d.goal), start: optStr(d.start), end: optStr(d.end), state: (str(d.state, "planned") as Sprint["state"]), closed_at: optStr(d.closed_at), created_at: str(d.created_at) });
    else if (entity === "comment" && d.deleted !== true) {
      const c: Comment = { id, issue_id: str(d.issue_id), body: str(d.body), author: str(d.author), created_at: str(d.created_at), edited_at: optStr(d.edited_at), _pending: d._pending === true };
      comments.set(c.issue_id, [...(comments.get(c.issue_id) ?? []), c]);
    } else if (entity === "worklog" && d.deleted !== true) {
      const w: Worklog = { id, issue_id: str(d.issue_id), member: str(d.member), minutes: num(d.minutes), date: str(d.date), note: str(d.note), created_at: str(d.created_at) };
      worklogs.set(w.issue_id, [...(worklogs.get(w.issue_id) ?? []), w]);
    }
  }
  for (const list of comments.values()) list.sort((a, b) => (a.created_at || "~").localeCompare(b.created_at || "~"));
  issues.sort(byRank);
  projects.sort((a, b) => a.name.localeCompare(b.name));
  sprints.sort((a, b) => (a.start ?? a.created_at ?? "").localeCompare(b.start ?? b.created_at ?? ""));
  const me = state.workspace.me;
  return {
    workspace, summary: state.workspace, me, role: members.get(me)?.role ?? state.workspace.role ?? "member",
    members, projects, projectById: new Map(projects.map((p) => [p.id, p])), issues, issueById: new Map(issues.map((i) => [i.id, i])),
    sprints, comments, worklogs, ops: state.ops, pending: state.pending,
  };
}

export const issueKey = (issue: Pick<Issue, "number" | "project_id">, projects: Map<string, Project>) =>
  `${projects.get(issue.project_id)?.key ?? "?"}-${issue.number ?? "?"}`;

export const memberName = (m: Model, id: string | null | undefined) => (id ? m.members.get(id)?.name ?? "Former member" : "Unassigned");

/** Mirrors `store::allowed` in Rust. The host has the final say. */
export function can(m: Model, action: "edit-issues" | "delete-issue" | "manage-sprints" | "edit-project" | "create-project" | "manage-members" | "workspace-settings" | "comment" | "log-work", target?: { issue?: Issue; projectId?: string }): boolean {
  const rank = { owner: 4, admin: 3, member: 2, viewer: 1 }[m.role] ?? 0;
  const admin = rank >= 3;
  const projectId = target?.projectId ?? target?.issue?.project_id;
  const lead = !!projectId && m.projectById.get(projectId)?.lead === m.me;
  switch (action) {
    case "comment": return rank >= 1;
    case "edit-issues": case "log-work": return rank >= 2;
    case "delete-issue": return admin || (rank >= 2 && target?.issue?.reporter === m.me);
    case "manage-sprints": case "edit-project": return admin || lead;
    case "create-project": return admin || (rank >= 2 && m.workspace.members_create_projects);
    case "manage-members": case "workspace-settings": return admin;
  }
}

/** New id: 12 hex chars of time + 20 random, like the Rust side. */
export function newId(): string {
  const time = Date.now().toString(16).padStart(12, "0").slice(-12);
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, "0")).join("");
  return time + rand;
}

/** Fields to send when an issue moves to `status`: done and canceled stamp `resolved_at`. */
export function statusFields(issue: Pick<Issue, "status" | "resolved_at">, status: StatusId): Record<string, unknown> {
  const fields: Record<string, unknown> = { status };
  if (isClosed(status) && !isClosed(issue.status)) fields.resolved_at = new Date().toISOString();
  if (!isClosed(status) && isClosed(issue.status)) fields.resolved_at = null;
  return fields;
}

/** Suggested project key from a name: "Mobile App" → "MA", "Website" → "WEB". */
export function suggestKey(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "PRJ";
  const key = words.length > 1 ? words.map((w) => w[0]).join("") : words[0].slice(0, 3);
  return (/^[A-Z]/.test(key) ? key : `P${key}`).slice(0, 6).padEnd(2, "X");
}

export interface IssueFilter { text?: string; assignee?: string; status?: string; type?: string; label?: string; priority?: number | null; sprint?: string }
export function filterIssues(issues: readonly Issue[], f: IssueFilter, projects: Map<string, Project>): Issue[] {
  const text = f.text?.trim().toLowerCase();
  return issues.filter((i) => {
    if (text && !`${issueKey(i, projects)} ${i.title} ${i.labels.join(" ")}`.toLowerCase().includes(text)) return false;
    if (f.assignee === "none" ? i.assignee !== null : f.assignee && i.assignee !== f.assignee) return false;
    if (f.status === "open" ? isClosed(i.status) : f.status && i.status !== f.status) return false;
    if (f.type && i.type !== f.type) return false;
    if (f.label && !i.labels.includes(f.label)) return false;
    if (f.priority !== undefined && f.priority !== null && i.priority !== f.priority) return false;
    if (f.sprint === "none" ? i.sprint_id !== null : f.sprint && i.sprint_id !== f.sprint) return false;
    return true;
  });
}
