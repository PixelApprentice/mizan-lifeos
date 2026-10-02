// Issue list with filters and sorting. "My issues" is the same list pinned to me.
import { useMemo, useState } from "react";
import { ISSUE_TYPES, PRIORITIES, STATUSES, filterIssues, isClosed, issueKey, memberName, statusLabel, type Issue } from "../model";
import { Avatar, Empty, PriorityMark, TypeMark, fmtDate, inlineCls, useWs } from "./ui";

type SortKey = "rank" | "priority" | "due" | "updated" | "key";

export default function IssueList({ mine = false }: { mine?: boolean }) {
  const { model, project, openIssue, newIssue } = useWs();
  const [text, setText] = useState("");
  const [status, setStatus] = useState(mine ? "open" : "");
  const [assignee, setAssignee] = useState("");
  const [type, setType] = useState("");
  const [label, setLabel] = useState("");
  const [priority, setPriority] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>(mine ? "priority" : "rank");

  const labels = useMemo(() => [...new Set(model.issues.flatMap((i) => i.labels))].sort(), [model]);
  const list = useMemo(() => {
    const base = model.issues.filter((i) => (mine || !project || i.project_id === project));
    const rows = filterIssues(base, { text, status, assignee: mine ? model.me : assignee || undefined, type, label, priority }, model.projectById);
    const pr = (i: Issue) => (i.priority === 0 ? 9 : i.priority);
    const cmp: Record<SortKey, (a: Issue, b: Issue) => number> = {
      rank: () => 0,
      priority: (a, b) => pr(a) - pr(b),
      due: (a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"),
      updated: (a, b) => b.created_at.localeCompare(a.created_at),
      key: (a, b) => issueKey(a, model.projectById).localeCompare(issueKey(b, model.projectById), undefined, { numeric: true }),
    };
    return [...rows].sort(cmp[sort]);
  }, [model, project, mine, text, status, assignee, type, label, priority, sort]);

  const groups = mine ? STATUSES.filter((s) => list.some((i) => i.status === s.id)).map((s) => ({ title: s.label, items: list.filter((i) => i.status === s.id) })) : [{ title: "", items: list }];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input aria-label="Search issues" placeholder="Search key, title, label…" className={`${inlineCls} max-w-64`} value={text} onChange={(e) => setText(e.target.value)} />
        <select aria-label="Status filter" className={`${inlineCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="open">Open</option>
          {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {!mine && (
          <select aria-label="Assignee filter" className={`${inlineCls} w-auto`} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
            {[...model.members.values()].map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        <select aria-label="Type filter" className={`${inlineCls} w-auto`} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Any type</option>
          {ISSUE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select aria-label="Priority filter" className={`${inlineCls} w-auto`} value={priority ?? ""} onChange={(e) => setPriority(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {labels.length > 0 && (
          <select aria-label="Label filter" className={`${inlineCls} w-auto`} value={label} onChange={(e) => setLabel(e.target.value)}>
            <option value="">Any label</option>
            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <select aria-label="Sort" className={`${inlineCls} w-auto`} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="rank">Board order</option>
          <option value="priority">Priority</option>
          <option value="due">Due date</option>
          <option value="updated">Newest</option>
          <option value="key">Key</option>
        </select>
        <span className="text-xs text-ink-dim">{list.length} issues</span>
        <button className="ml-auto border border-edge px-3 py-1.5 hover:border-accent" onClick={() => newIssue(mine ? { assignee: model.me } : { project_id: project || undefined })}>+ Issue</button>
      </div>
      {!list.length ? (
        <Empty>{mine ? "Nothing assigned to you. Enjoy the calm, or pick something from the backlog." : "No issues match these filters."}</Empty>
      ) : groups.map((g) => (
        <div key={g.title || "all"}>
          {g.title && <h3 className="mb-1 mt-2 text-xs uppercase tracking-widest text-ink-dim">{g.title} · {g.items.length}</h3>}
          <table className="w-full border-collapse text-sm">
            <thead className="sr-only"><tr><th>Type</th><th>Key</th><th>Title</th><th>Status</th><th>Priority</th><th>Due</th><th>Assignee</th></tr></thead>
            <tbody>
              {g.items.map((i) => (
                <tr key={i.id} tabIndex={0} onClick={() => openIssue(i.id)} onKeyDown={(e) => e.key === "Enter" && openIssue(i.id)} className="cursor-pointer border-b border-edge/60 hover:bg-panel-2 focus:bg-panel-2 focus:outline-none">
                  <td className="w-5 py-1.5 pl-2"><TypeMark type={i.type} /></td>
                  <td className="w-20 whitespace-nowrap text-xs text-ink-dim">{issueKey(i, model.projectById)}</td>
                  <td className={`truncate ${isClosed(i.status) ? "text-ink-dim line-through" : ""}`}>{i.title}{i._pending && <span className="ml-1 text-gold" title="Waiting to sync">•</span>}</td>
                  <td className="hidden w-28 text-xs text-ink-dim sm:table-cell">{statusLabel(i.status)}</td>
                  <td className="w-6"><PriorityMark value={i.priority} /></td>
                  <td className={`hidden w-16 text-xs md:table-cell ${i.due && !isClosed(i.status) && i.due < new Date().toISOString().slice(0, 10) ? "text-danger" : "text-ink-dim"}`}>{fmtDate(i.due)}</td>
                  <td className="w-8 pr-2" title={memberName(model, i.assignee)}><Avatar model={model} id={i.assignee} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
