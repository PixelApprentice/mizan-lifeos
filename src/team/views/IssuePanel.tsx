// Issue detail drawer: every field, checklist, labels, comments, work log and activity.
import { useEffect, useState } from "react";
import { create, remove, set } from "../api";
import { activity } from "../inbox";
import { ISSUE_TYPES, PRIORITIES, can, issueKey, memberName, statusFields, type ChecklistItem, type Issue, type IssueType } from "../model";
import { useDialogFocus } from "../../components/useDialogFocus";
import { Avatar, Field, MemberSelect, StatusSelect, ago, inputCls, inlineCls, useWs } from "./ui";

function Checklist({ issue, disabled }: { issue: Issue; disabled: boolean }) {
  const { run } = useWs();
  const [text, setText] = useState("");
  const save = (checklist: ChecklistItem[]) => void run([set("issue", issue.id, { checklist })]);
  const done = issue.checklist.filter((c) => c.done).length;
  return (
    <div>
      <h4 className="mb-1 text-xs uppercase tracking-widest text-ink-dim">Checklist {issue.checklist.length ? `${done}/${issue.checklist.length}` : ""}</h4>
      <ul className="space-y-1">
        {issue.checklist.map((c, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label={c.text} disabled={disabled} checked={c.done} onChange={() => save(issue.checklist.map((x, k) => (k === i ? { ...x, done: !x.done } : x)))} />
            <span className={`flex-1 ${c.done ? "text-ink-dim line-through" : ""}`}>{c.text}</span>
            {!disabled && <button aria-label={`Remove ${c.text}`} className="text-xs text-ink-dim hover:text-danger" onClick={() => save(issue.checklist.filter((_, k) => k !== i))}>✕</button>}
          </li>
        ))}
      </ul>
      {!disabled && (
        <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { save([...issue.checklist, { text: text.trim().slice(0, 300), done: false }]); setText(""); } }}>
          <input aria-label="New checklist item" placeholder="Add a step" className={inputCls} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="border border-edge px-2 text-sm">Add</button>
        </form>
      )}
    </div>
  );
}

function Comments({ issue }: { issue: Issue }) {
  const { model, run, ask } = useWs();
  const [body, setBody] = useState("");
  const list = model.comments.get(issue.id) ?? [];
  const send = async () => {
    if (!body.trim()) return;
    if (await run([create("comment", { issue_id: issue.id, body: body.trim(), created_at: new Date().toISOString() })])) setBody("");
  };
  return (
    <div>
      <h4 className="mb-2 text-xs uppercase tracking-widest text-ink-dim">Comments · {list.length}</h4>
      <ul className="space-y-3">
        {list.map((c) => (
          <li key={c.id} className="flex gap-2 text-sm">
            <Avatar model={model} id={c.author} />
            <div className="flex-1">
              <div className="text-xs text-ink-dim">{memberName(model, c.author)} · {c.created_at ? ago(c.created_at) : ""}{c._pending ? " · sending" : ""}{c.edited_at ? " · edited" : ""}</div>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </div>
            {(c.author === model.me || can(model, "workspace-settings")) && (
              <button className="self-start text-xs text-ink-dim hover:text-danger" aria-label="Delete comment" onClick={() => ask({ title: "Delete this comment?", confirmLabel: "Delete", danger: true, onConfirm: async () => { await run([remove("comment", c.id)]); } })}>✕</button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-col gap-2">
        <textarea aria-label="Write a comment" placeholder="Write a comment. @name mentions a teammate." className={`${inputCls} min-h-16`} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} />
        <button className="self-end border border-edge px-3 py-1 text-sm hover:border-accent" disabled={!body.trim()} onClick={send}>Comment</button>
      </div>
    </div>
  );
}

function WorkLog({ issue, disabled }: { issue: Issue; disabled: boolean }) {
  const { model, run } = useWs();
  const [minutes, setMinutes] = useState("");
  const list = model.worklogs.get(issue.id) ?? [];
  const total = list.reduce((s, w) => s + w.minutes, 0);
  const add = async () => {
    const n = Math.round(Number(minutes));
    if (!(n >= 1 && n <= 1440)) return;
    if (await run([create("worklog", { issue_id: issue.id, member: model.me, minutes: n, date: new Date().toISOString().slice(0, 10), note: "", created_at: new Date().toISOString() })])) setMinutes("");
  };
  return (
    <div>
      <h4 className="mb-1 text-xs uppercase tracking-widest text-ink-dim">Time logged · {Math.floor(total / 60)}h {total % 60}m</h4>
      <ul className="space-y-0.5 text-xs text-ink-dim">
        {list.slice(-6).map((w) => <li key={w.id}>{memberName(model, w.member)} · {w.minutes} min · {w.date}{w.note ? ` · ${w.note}` : ""}</li>)}
      </ul>
      {!disabled && (
        <div className="mt-1 flex gap-2">
          <input aria-label="Minutes worked" inputMode="numeric" placeholder="minutes" className={`${inlineCls} w-24`} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <button className="border border-edge px-2 text-sm" onClick={add}>Log</button>
        </div>
      )}
    </div>
  );
}

export default function IssuePanel({ id, close }: { id: string; close: () => void }) {
  const { model, run, ask, newIssue, openIssue } = useWs();
  const issue = model.issueById.get(id);
  const ref = useDialogFocus(true);
  const [title, setTitle] = useState(issue?.title ?? "");
  const [description, setDescription] = useState(issue?.description ?? "");
  const [label, setLabel] = useState("");
  useEffect(() => { setTitle(issue?.title ?? ""); setDescription(issue?.description ?? ""); }, [issue?.id, issue?.title, issue?.description]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  if (!issue) {
    return (
      <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={close}>
        <div className="panel h-full w-[min(640px,100vw)] bg-panel p-6" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-ink-dim">This issue was deleted or is not synced yet.</p>
          <button className="mt-3 border border-edge px-3 py-1 text-sm" onClick={close}>Close</button>
        </div>
      </div>
    );
  }
  const editable = can(model, "edit-issues");
  const save = (fields: Record<string, unknown>) => void run([set("issue", issue.id, fields)]);
  const key = issueKey(issue, model.projectById);
  const sprints = model.sprints.filter((s) => s.project_id === issue.project_id && s.state !== "closed");
  const children = model.issues.filter((i) => i.parent_id === issue.id);
  const parent = issue.parent_id ? model.issueById.get(issue.parent_id) : undefined;
  const epics = model.issues.filter((i) => i.type === "epic" && i.project_id === issue.project_id && i.id !== issue.id);
  const history = activity(model, issue.id);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={close}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={`${key} ${issue.title}`} onClick={(e) => e.stopPropagation()} className="panel flex h-full w-[min(720px,100vw)] flex-col overflow-y-auto bg-panel">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-edge bg-panel px-5 py-3 text-sm">
          <span className="text-ink-dim">{model.projectById.get(issue.project_id)?.name} /</span>
          <span className="font-bold">{key}</span>
          {issue._pending && <span className="text-xs text-gold">waiting to sync</span>}
          <button className="ml-auto border border-edge px-2 py-0.5" onClick={() => navigator.clipboard?.writeText(`${key} ${issue.title}`)}>Copy key</button>
          <button aria-label="Close issue" className="border border-edge px-2 py-0.5" onClick={close}>✕</button>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-[1fr_220px]">
          <div className="space-y-4">
            <input aria-label="Title" disabled={!editable} className="w-full border border-transparent bg-transparent text-lg font-bold outline-none hover:border-edge focus:border-accent" value={title} maxLength={300}
              onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== issue.title && save({ title: title.trim() })} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
            <textarea aria-label="Description" disabled={!editable} placeholder="Add a description" className={`${inputCls} min-h-28`} value={description}
              onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== issue.description && save({ description })} />
            {parent && <p className="text-sm">Part of <button className="underline" onClick={() => openIssue(parent.id)}>{issueKey(parent, model.projectById)} {parent.title}</button></p>}
            {(issue.type === "epic" || children.length > 0) && (
              <div>
                <h4 className="mb-1 text-xs uppercase tracking-widest text-ink-dim">Child issues · {children.filter((c) => c.status === "done").length}/{children.length} done</h4>
                <ul className="text-sm">{children.map((c) => <li key={c.id}><button className="text-left hover:underline" onClick={() => openIssue(c.id)}>{issueKey(c, model.projectById)} {c.title}</button> <span className="text-ink-dim">· {c.status.replace("_", " ")}</span></li>)}</ul>
                {editable && <button className="mt-1 text-xs underline" onClick={() => newIssue({ project_id: issue.project_id, parent_id: issue.id, sprint_id: issue.sprint_id })}>+ Child issue</button>}
              </div>
            )}
            <Checklist issue={issue} disabled={!editable} />
            <Comments issue={issue} />
            <div>
              <h4 className="mb-1 text-xs uppercase tracking-widest text-ink-dim">Activity</h4>
              <ul className="space-y-0.5 text-xs text-ink-dim">{history.slice(0, 30).map((h, i) => <li key={i}>{h.who} {h.text} · {ago(h.at)}</li>)}</ul>
            </div>
          </div>
          <aside className="space-y-3">
            <Field label="Status"><StatusSelect disabled={!editable} value={issue.status} onChange={(s) => save(statusFields(issue, s))} /></Field>
            <Field label="Assignee">
              <MemberSelect model={model} disabled={!editable} value={issue.assignee} onChange={(a) => save({ assignee: a })} />
              {editable && issue.assignee !== model.me && <button className="self-start text-xs underline" onClick={() => save({ assignee: model.me })}>Assign to me</button>}
            </Field>
            <Field label="Priority">
              <select disabled={!editable} className={inputCls} value={issue.priority} onChange={(e) => save({ priority: Number(e.target.value) })}>
                {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select disabled={!editable} className={inputCls} value={issue.type} onChange={(e) => save({ type: e.target.value as IssueType })}>
                {ISSUE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Sprint">
              <select disabled={!editable} className={inputCls} value={issue.sprint_id ?? ""} onChange={(e) => save({ sprint_id: e.target.value || null })}>
                <option value="">Backlog</option>
                {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.state === "active" ? " (active)" : ""}</option>)}
                {issue.sprint_id && !sprints.some((s) => s.id === issue.sprint_id) && <option value={issue.sprint_id}>{model.sprints.find((s) => s.id === issue.sprint_id)?.name ?? "Closed sprint"}</option>}
              </select>
            </Field>
            <Field label={model.workspace.estimate_unit === "hours" ? "Estimate (hours)" : "Estimate (points)"}>
              <input disabled={!editable} inputMode="decimal" className={inputCls} defaultValue={issue.estimate ?? ""} key={`est-${issue.estimate}`}
                onBlur={(e) => { const v = e.target.value.trim(); const n = v === "" ? null : Number(v); if ((n === null || (n >= 0 && n <= 10000)) && n !== issue.estimate) save({ estimate: n }); }} />
            </Field>
            <Field label="Due">
              <input type="date" disabled={!editable} className={inputCls} value={issue.due?.slice(0, 10) ?? ""} onChange={(e) => save({ due: e.target.value || null })} />
            </Field>
            {epics.length > 0 && issue.type !== "epic" && (
              <Field label="Epic">
                <select disabled={!editable} className={inputCls} value={issue.parent_id ?? ""} onChange={(e) => save({ parent_id: e.target.value || null })}>
                  <option value="">None</option>
                  {epics.map((e) => <option key={e.id} value={e.id}>{issueKey(e, model.projectById)} {e.title}</option>)}
                </select>
              </Field>
            )}
            <div>
              <span className="text-xs text-ink-dim">Labels</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {issue.labels.map((l) => <span key={l} className="flex items-center gap-1 border border-edge px-1.5 text-xs">{l}{editable && <button aria-label={`Remove label ${l}`} onClick={() => save({ labels: issue.labels.filter((x) => x !== l) })}>✕</button>}</span>)}
              </div>
              {editable && <form className="mt-1" onSubmit={(e) => { e.preventDefault(); const l = label.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40); if (l && !issue.labels.includes(l)) save({ labels: [...issue.labels, l] }); setLabel(""); }}>
                <input aria-label="Add label" placeholder="+ label" className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} />
              </form>}
            </div>
            <WorkLog issue={issue} disabled={!can(model, "log-work")} />
            <p className="text-xs text-ink-dim">Reported by {memberName(model, issue.reporter)}{issue.created_at ? ` · ${ago(issue.created_at)}` : ""}</p>
            {can(model, "delete-issue", { issue }) && (
              <button className="w-full border border-danger/50 px-3 py-1.5 text-sm text-danger hover:border-danger" onClick={() => ask({ title: `Delete ${key}?`, body: "Teammates will no longer see it. The history keeps a record.", confirmLabel: "Delete issue", danger: true, onConfirm: async () => { if (await run([remove("issue", issue.id)])) close(); } })}>Delete issue</button>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
