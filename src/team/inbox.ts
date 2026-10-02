// Inbox: what changed that concerns me, derived from the op log the host sends with each pull.
import type { Model, TeamOp } from "./model.ts";
import { issueKey, memberName, statusLabel } from "./model.ts";

export interface InboxItem { seq: number; at: string; who: string; member: string; issueId: string; text: string; kind: "assigned" | "comment" | "mention" | "status" }

export function inbox(m: Model, limit = 100): InboxItem[] {
  const me = m.me;
  const myName = m.members.get(me)?.name.toLowerCase() ?? "";
  const out: InboxItem[] = [];
  const issueOf = (op: TeamOp) => {
    if (op.entity === "issue") return op.id;
    if (op.entity === "comment") {
      const v = op.fields.issue_id;
      if (typeof v === "string") return v;
      for (const list of m.comments.values()) for (const c of list) if (c.id === op.id) return c.issue_id;
    }
    return null;
  };
  for (const op of [...m.ops].sort((a, b) => b.seq - a.seq)) {
    if (op.member === me) continue;
    const issueId = issueOf(op);
    if (!issueId) continue;
    const issue = m.issueById.get(issueId);
    if (!issue) continue;
    const key = issueKey(issue, m.projectById);
    const who = memberName(m, op.member);
    const mine = issue.assignee === me || issue.reporter === me;
    if (op.entity === "issue" && op.fields.assignee === me) {
      out.push({ seq: op.seq, at: op.at, who, member: op.member, issueId, kind: "assigned", text: `${who} assigned you ${key} ${issue.title}` });
    } else if (op.entity === "comment" && op.kind === "create") {
      const body = typeof op.fields.body === "string" ? op.fields.body : "";
      const mentioned = !!myName && new RegExp(`@${myName.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body);
      if (mentioned) out.push({ seq: op.seq, at: op.at, who, member: op.member, issueId, kind: "mention", text: `${who} mentioned you on ${key}: ${body.slice(0, 120)}` });
      else if (mine) out.push({ seq: op.seq, at: op.at, who, member: op.member, issueId, kind: "comment", text: `${who} commented on ${key}: ${body.slice(0, 120)}` });
    } else if (op.entity === "issue" && typeof op.fields.status === "string" && mine && op.kind === "set") {
      out.push({ seq: op.seq, at: op.at, who, member: op.member, issueId, kind: "status", text: `${who} moved ${key} to ${statusLabel(op.fields.status)}` });
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Plain-language activity lines for one issue, newest first. */
export function activity(m: Model, issueId: string): { at: string; who: string; text: string }[] {
  const lines: { at: string; who: string; text: string; seq: number }[] = [];
  for (const op of m.ops) {
    if (op.entity !== "issue" || op.id !== issueId) continue;
    const who = memberName(m, op.member);
    if (op.kind === "create") { lines.push({ seq: op.seq, at: op.at, who, text: "created the issue" }); continue; }
    if (op.kind === "delete") { lines.push({ seq: op.seq, at: op.at, who, text: "deleted the issue" }); continue; }
    const parts: string[] = [];
    for (const [k, v] of Object.entries(op.fields)) {
      if (k === "status" && typeof v === "string") parts.push(`moved to ${statusLabel(v)}`);
      else if (k === "assignee") parts.push(v ? `assigned ${memberName(m, String(v))}` : "unassigned it");
      else if (k === "sprint_id") parts.push(v ? `moved to ${m.sprints.find((s) => s.id === v)?.name ?? "a sprint"}` : "moved to the backlog");
      else if (k === "rank" || k === "resolved_at") continue;
      else parts.push(`changed ${k.replace(/_/g, " ")}`);
    }
    if (parts.length) lines.push({ seq: op.seq, at: op.at, who, text: parts.join(", ") });
  }
  return lines.sort((a, b) => b.seq - a.seq);
}
