// In-browser stand-in for the team host, used by `pnpm dev` without Tauri and by demo
// recordings. Same command shapes as src-tauri/src/team/mod.rs; no permissions or network.
import type { OpInput, TeamOp, TeamRow, WorkspaceSummary } from "./model.ts";
import { initialRanks } from "./rank.ts";

interface DemoWs { id: string; me: string; rows: Map<string, TeamRow>; ops: TeamOp[]; seq: number; counters: Map<string, number> }

const spaces = new Map<string, DemoWs>();
let hosting = { enabled: false, running: false, port: 47616, addresses: ["192.168.1.20"], error: null as string | null };
let n = 0;
const id = () => `${Date.now().toString(16).padStart(12, "0")}${(++n).toString(16).padStart(20, "0")}`;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();

function apply(ws: DemoWs, member: string, op: OpInput, at = new Date().toISOString()): TeamOp {
  const key = `${op.entity}/${op.id}`;
  const kind = op.kind ?? "set";
  const fields = { ...(op.fields ?? {}) };
  const existing = ws.rows.get(key);
  if (op.entity === "issue" && kind === "create") {
    const project = String(fields.project_id);
    const next = (ws.counters.get(project) ?? 0) + 1;
    ws.counters.set(project, next);
    fields.number = next;
    fields.reporter ??= member;
    fields.created_at ??= at;
  }
  if (op.entity === "comment" && kind === "create") { fields.author = member; fields.created_at ??= at; }
  if (op.entity === "worklog" && kind === "create") { fields.member ??= member; fields.created_at ??= at; }
  if (kind === "delete") fields.deleted = true;
  const data = { ...(existing?.data ?? {}), ...fields };
  ws.rows.set(key, { entity: op.entity, id: op.id, data });
  const done: TeamOp = { seq: ++ws.seq, op_id: id(), member, hlc: "", entity: op.entity, id: op.id, kind, fields, at };
  ws.ops.push(done);
  return done;
}

function seed(): DemoWs {
  const ws: DemoWs = { id: "demo-acme", me: "m_you", rows: new Map(), ops: [], seq: 0, counters: new Map() };
  const people = [
    ["m_you", "You", "owner", "#6ee7b7"], ["m_amina", "Amina", "admin", "#f9a8d4"],
    ["m_bilal", "Bilal", "member", "#93c5fd"], ["m_chen", "Chen", "member", "#fcd34d"], ["m_dana", "Dana", "viewer", "#c4b5fd"],
  ] as const;
  apply(ws, "m_you", { entity: "workspace", id: "ws", kind: "create", fields: { name: "Acme Studio", description: "Product team for the Acme apps.", members_create_projects: true, estimate_unit: "points" } }, day(-30));
  for (const [mid, name, role, color] of people) apply(ws, "m_you", { entity: "member", id: mid, kind: "create", fields: { name, role, active: true, color, joined_at: day(-30) } }, day(-30));
  apply(ws, "m_you", { entity: "project", id: "p_web", kind: "create", fields: { key: "WEB", name: "Website relaunch", description: "New marketing site and sign-up flow.", color: "#60a5fa", lead: "m_amina", status: "active", target: day(21).slice(0, 10), created_at: day(-30) } }, day(-30));
  apply(ws, "m_you", { entity: "project", id: "p_app", kind: "create", fields: { key: "APP", name: "Mobile app", description: "iOS and Android client.", color: "#f472b6", lead: "m_you", status: "active", target: null, created_at: day(-25) } }, day(-25));
  apply(ws, "m_amina", { entity: "sprint", id: "s_1", kind: "create", fields: { project_id: "p_web", name: "WEB Sprint 1", goal: "Ship the design system.", start: day(-21).slice(0, 10), end: day(-8).slice(0, 10), state: "closed", closed_at: day(-8) } }, day(-21));
  apply(ws, "m_amina", { entity: "sprint", id: "s_2", kind: "create", fields: { project_id: "p_web", name: "WEB Sprint 2", goal: "Sign-up flow ready for beta users.", start: day(-6).slice(0, 10), end: day(7).slice(0, 10), state: "active", closed_at: null } }, day(-7));
  const issues: [string, string, string, string, number, string | null, number | null, string | null, number][] = [
    // project, title, type, status, priority, assignee, estimate, sprint, created offset
    ["p_web", "Design tokens for colour and type", "story", "done", 2, "m_amina", 5, "s_1", -20],
    ["p_web", "Header and footer components", "task", "done", 3, "m_bilal", 3, "s_1", -19],
    ["p_web", "Pricing page copy", "task", "done", 4, "m_chen", 2, "s_1", -18],
    ["p_web", "Sign-up form with email check", "story", "in_progress", 1, "m_you", 5, "s_2", -6],
    ["p_web", "Password rules are not shown on mobile", "bug", "todo", 2, "m_bilal", 2, "s_2", -5],
    ["p_web", "Welcome email template", "task", "in_review", 3, "m_chen", 3, "s_2", -6],
    ["p_web", "Analytics events for the funnel", "task", "done", 3, "m_you", 3, "s_2", -6],
    ["p_web", "Cookie banner", "task", "todo", 4, null, 1, "s_2", -4],
    ["p_web", "Blog section", "epic", "backlog", 0, null, 8, null, -3],
    ["p_web", "Dark mode for the docs pages", "story", "backlog", 4, null, 3, null, -2],
    ["p_app", "Offline cache for the feed", "story", "in_progress", 2, "m_you", 8, null, -10],
    ["p_app", "Crash when rotating on the login screen", "bug", "todo", 1, "m_bilal", 2, null, -3],
    ["p_app", "Push notification settings", "task", "todo", 3, "m_chen", 3, null, -2],
    ["p_app", "App store screenshots", "task", "backlog", 4, null, null, null, -1],
  ];
  const ranks = initialRanks(issues.length);
  const ids: string[] = [];
  issues.forEach(([project_id, title, type, status, priority, assignee, estimate, sprint_id, created], k) => {
    const iid = `i_${k + 1}`;
    ids.push(iid);
    const resolved = status === "done" ? day(sprint_id === "s_1" ? -10 + (k % 3) : -3 + (k % 3)) : null;
    apply(ws, k % 2 ? "m_amina" : "m_you", {
      entity: "issue", id: iid, kind: "create",
      fields: { project_id, title, type, status: "todo", priority, assignee: null, estimate, sprint_id, rank: ranks[k], labels: type === "bug" ? ["bug-bash"] : k < 3 ? ["design"] : [], checklist: [], description: "", due: null, parent_id: null, resolved_at: null, created_at: day(created) },
    }, day(created));
    const updates: Record<string, unknown> = {};
    if (assignee) updates.assignee = assignee;
    if (status !== "todo") updates.status = status;
    if (resolved) updates.resolved_at = resolved;
    if (Object.keys(updates).length) apply(ws, assignee === "m_you" ? "m_amina" : assignee ?? "m_amina", { entity: "issue", id: iid, fields: updates }, resolved ?? day(created + 1));
  });
  apply(ws, "m_you", { entity: "issue", id: "i_4", fields: { due: day(2).slice(0, 10), description: "Validate the address before submit and show a friendly hint.", checklist: [{ text: "Client-side validation", done: true }, { text: "Server check", done: false }, { text: "Error copy reviewed", done: false }] } }, day(-5));
  apply(ws, "m_bilal", { entity: "comment", id: "c_1", kind: "create", fields: { issue_id: "i_4", body: "@You the API returns 409 for taken emails now." } }, day(-2));
  apply(ws, "m_chen", { entity: "comment", id: "c_2", kind: "create", fields: { issue_id: "i_6", body: "Draft is in review. Feedback welcome." } }, day(-1));
  apply(ws, "m_amina", { entity: "issue", id: "i_11", fields: { status: "in_progress" } }, day(-1));
  apply(ws, "m_you", { entity: "worklog", id: "w_1", kind: "create", fields: { issue_id: "i_4", member: "m_you", minutes: 50, date: day(-1).slice(0, 10), note: "Focus session" } }, day(-1));
  return ws;
}

function summary(ws: DemoWs): WorkspaceSummary {
  return { id: ws.id, name: String(ws.rows.get("workspace/ws")?.data.name ?? "Workspace"), mode: "host", me: ws.me, role: (ws.rows.get(`member/${ws.me}`)?.data.role as WorkspaceSummary["role"]) ?? "owner", pending: 0, last_sync: "", error: "", host: "" };
}

function get(wsId: string): DemoWs {
  if (!spaces.size) { const s = seed(); spaces.set(s.id, s); }
  const ws = spaces.get(wsId);
  if (!ws) throw new Error("This workspace no longer exists.");
  return ws;
}

export const changed = new EventTarget();
const emit = (ws: string) => changed.dispatchEvent(new CustomEvent("changed", { detail: ws }));

export function demoTeam(cmd: string, args: Record<string, unknown>): unknown {
  if (!spaces.size) { const s = seed(); spaces.set(s.id, s); }
  switch (cmd) {
    case "team_list": return [...spaces.values()].map(summary);
    case "team_create": {
      const ws: DemoWs = { id: id(), me: id(), rows: new Map(), ops: [], seq: 0, counters: new Map() };
      apply(ws, ws.me, { entity: "workspace", id: "ws", kind: "create", fields: { name: args.name, description: "", members_create_projects: true, estimate_unit: "points" } });
      apply(ws, ws.me, { entity: "member", id: ws.me, kind: "create", fields: { name: args.ownerName, role: "owner", active: true, color: "#6ee7b7", joined_at: new Date().toISOString() } });
      spaces.set(ws.id, ws);
      return summary(ws);
    }
    case "team_state": {
      const ws = get(String(args.ws));
      return { rows: [...ws.rows.values()].map((r) => ({ ...r, data: { ...r.data } })), ops: ws.ops.slice(-400), pending: 0, workspace: summary(ws) };
    }
    case "team_submit": {
      const ws = get(String(args.ws));
      const accepted = (args.ops as OpInput[]).map((op) => ({ op_id: apply(ws, ws.me, op).op_id }));
      emit(ws.id);
      return { accepted, rejected: [] };
    }
    case "team_sync": return summary(get(String(args.ws)));
    case "team_hosting":
      if (typeof args.enabled === "boolean") hosting = { ...hosting, enabled: args.enabled, running: args.enabled };
      return hosting;
    case "team_invite": {
      const link = `mizan-team://join?ws=${args.ws}&code=demo${Math.random().toString(16).slice(2, 10)}&hosts=${hosting.addresses.join(",")}&port=${hosting.port}&name=Demo`;
      return { link, qr_svg: "", role: args.role, expires_in_days: 7 };
    }
    case "team_join": throw new Error("Joining needs the desktop app. The browser preview runs a local demo workspace only.");
    case "team_remove": spaces.delete(String(args.ws)); return null;
    case "team_export": return "~/Downloads/mizan-team-demo.json";
    case "team_my_issues": {
      const out: unknown[] = [];
      for (const ws of spaces.values()) {
        const keys = new Map([...ws.rows.values()].filter((r) => r.entity === "project").map((r) => [r.id, String(r.data.key)]));
        for (const r of ws.rows.values()) {
          const d = r.data;
          if (r.entity === "issue" && d.assignee === ws.me && d.status !== "done" && d.status !== "canceled" && !d.deleted)
            out.push({ ws: ws.id, ws_name: summary(ws).name, id: r.id, key: `${keys.get(String(d.project_id))}-${d.number}`, title: d.title, status: d.status, priority: d.priority, due: d.due ?? null, estimate: d.estimate ?? null });
        }
      }
      return out;
    }
  }
  throw new Error(`Unknown team command ${cmd}`);
}
