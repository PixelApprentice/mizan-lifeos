// Backlog and sprints for one project: plan sprints by dragging issues between the backlog
// and sprint lists, start a sprint, and complete it (unfinished work carries over).
import { useMemo, useState } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent,
} from "@dnd-kit/core";
import { create, set } from "../api";
import { can, isClosed, issueKey, statusLabel, type Issue, type OpInput, type Sprint } from "../model";
import { rankForDrop } from "../rank";
import { Avatar, Empty, PriorityMark, TypeMark, fmtDate, inputCls, useWs } from "./ui";

const collision: CollisionDetection = (args) => {
  const hits = args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);
  const types = new Map(args.droppableContainers.map((c) => [c.id, c.data.current?.type]));
  const rows = hits.filter((h) => types.get(h.id) === "row");
  return rows.length ? rows : hits;
};
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

function Row({ issue, disabled }: { issue: Issue; disabled: boolean }) {
  const { model, openIssue } = useWs();
  const drag = useDraggable({ id: issue.id, data: { type: "row" }, disabled });
  const drop = useDroppable({ id: issue.id, data: { type: "row", sprint: issue.sprint_id } });
  return (
    <li
      ref={(el) => { drag.setNodeRef(el); drop.setNodeRef(el); }}
      {...drag.attributes}
      {...drag.listeners}
      onClick={() => openIssue(issue.id)}
      onKeyDown={(e) => { if (e.key === "Enter") openIssue(issue.id); else drag.listeners?.onKeyDown?.(e); }}
      className={`flex cursor-grab items-center gap-2 border-b border-edge/60 px-3 py-1.5 text-sm hover:bg-panel-2 ${drag.isDragging ? "opacity-30" : ""} ${drop.isOver ? "bg-accent-dim" : ""}`}
    >
      <TypeMark type={issue.type} />
      <span className="w-16 shrink-0 text-xs text-ink-dim">{issueKey(issue, model.projectById)}</span>
      <span className={`flex-1 truncate ${isClosed(issue.status) ? "text-ink-dim line-through" : ""}`}>{issue.title}</span>
      <span className="hidden text-xs text-ink-dim sm:inline">{statusLabel(issue.status)}</span>
      <PriorityMark value={issue.priority} />
      <span className="w-8 text-right text-xs text-ink-dim">{issue.estimate ?? "–"}</span>
      <Avatar model={model} id={issue.assignee} />
    </li>
  );
}

function Section({ id, title, meta, issues, actions, disabled, children }: { id: string; title: string; meta?: string; issues: Issue[]; actions?: React.ReactNode; disabled: boolean; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `sec:${id}`, data: { type: "section", sprint: id === "backlog" ? null : id } });
  const points = issues.reduce((s, i) => s + (i.estimate ?? 0), 0);
  return (
    <section ref={setNodeRef} className={`border bg-panel ${isOver ? "border-accent" : "border-edge"}`} aria-label={title}>
      <header className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <h3 className="font-bold">{title}</h3>
        <span className="text-xs text-ink-dim">{issues.length} issues · {points} est.{meta ? ` · ${meta}` : ""}</span>
        <div className="ml-auto flex gap-2">{actions}</div>
      </header>
      {children}
      <ul className="min-h-10">{issues.map((i) => <Row key={i.id} issue={i} disabled={disabled} />)}</ul>
      {!issues.length && <p className="px-3 py-3 text-xs text-ink-dim">Drag issues here.</p>}
    </section>
  );
}

function SprintEditor({ sprint, close }: { sprint: Sprint; close: () => void }) {
  const { run } = useWs();
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal);
  const [start, setStart] = useState(sprint.start ?? today());
  const [end, setEnd] = useState(sprint.end ?? plusDays(today(), 14));
  const save = async () => {
    if (end < start) return;
    if (await run([set("sprint", sprint.id, { name: name.trim() || sprint.name, goal, start, end })])) close();
  };
  return (
    <div className="grid gap-2 border-b border-edge p-3 sm:grid-cols-4">
      <input aria-label="Sprint name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Sprint goal" placeholder="Goal" className={inputCls} value={goal} onChange={(e) => setGoal(e.target.value)} />
      <input aria-label="Start date" type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
      <input aria-label="End date" type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
      {end < start && <p role="alert" className="text-xs text-danger sm:col-span-4">The end date is before the start.</p>}
      <div className="flex gap-2 sm:col-span-4">
        <button className="btn-px bg-accent px-3 py-1 text-xs font-semibold text-black" onClick={save}>Save</button>
        <button className="border border-edge px-3 py-1 text-xs" onClick={close}>Cancel</button>
      </div>
    </div>
  );
}

export default function Backlog() {
  const { model, project, setProject, run, ask, newIssue } = useWs();
  const [editing, setEditing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const p = model.projectById.get(project);
  const issues = useMemo(() => model.issues.filter((i) => i.project_id === project), [model, project]);
  const sprints = model.sprints.filter((s) => s.project_id === project);
  const open = sprints.filter((s) => s.state !== "closed").sort((a, b) => (a.state === "active" ? -1 : b.state === "active" ? 1 : 0));
  const closed = sprints.filter((s) => s.state === "closed").reverse();
  const manage = can(model, "manage-sprints", { projectId: project });
  const editable = can(model, "edit-issues");

  if (!p) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-dim">Sprints belong to a project. Pick one:</p>
        <div className="flex flex-wrap gap-2">
          {model.projects.map((x) => <button key={x.id} onClick={() => setProject(x.id)} className="border border-edge px-3 py-2 text-sm hover:border-accent">{x.key} · {x.name}</button>)}
        </div>
        {!model.projects.length && <Empty>No projects yet. Create one in Settings.</Empty>}
      </div>
    );
  }

  const inSprint = (id: string | null) => issues.filter((i) => i.sprint_id === id && (id !== null || !isClosed(i.status)));

  const addSprint = () => {
    const last = sprints[sprints.length - 1];
    const start = last?.end && last.end >= today() ? plusDays(last.end, 1) : today();
    void run([create("sprint", { project_id: project, name: `${p.key} Sprint ${sprints.length + 1}`, goal: "", start, end: plusDays(start, 13), state: "planned", closed_at: null, created_at: new Date().toISOString() })]);
  };

  const startSprint = (s: Sprint) => {
    if (sprints.some((x) => x.state === "active")) {
      ask({ title: "Another sprint is running", body: "Complete the active sprint before starting the next one.", confirmLabel: "OK", onConfirm: () => {} });
      return;
    }
    const start = s.start && s.start >= today() ? today() : s.start ?? today();
    void run([set("sprint", s.id, { state: "active", start, end: s.end && s.end > start ? s.end : plusDays(start, 13) })]);
  };

  const completeSprint = (s: Sprint) => {
    const left = issues.filter((i) => i.sprint_id === s.id && !isClosed(i.status));
    const next = open.find((x) => x.id !== s.id && x.state === "planned");
    const doneCount = issues.filter((i) => i.sprint_id === s.id && i.status === "done").length;
    ask({
      title: `Complete ${s.name}?`,
      body: `${doneCount} done. ${left.length} unfinished issue${left.length === 1 ? "" : "s"} will move to ${next ? next.name : "the backlog"}.`,
      confirmLabel: "Complete sprint",
      onConfirm: async () => {
        const ops: OpInput[] = [set("sprint", s.id, { state: "closed", closed_at: new Date().toISOString() })];
        for (const i of left) ops.push(set("issue", i.id, { sprint_id: next?.id ?? null }));
        if (!(await run(ops))) throw new Error("The sprint was not completed.");
      },
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const issue = model.issueById.get(String(e.active.id));
    if (!issue || !e.over || e.over.id === issue.id) return;
    const data = e.over.data.current as { type: string; sprint: string | null } | undefined;
    if (!data) return;
    const target = data.sprint;
    const list = inSprint(target).filter((i) => i.id !== issue.id);
    let rank: string;
    if (data.type === "row") {
      const idx = list.findIndex((i) => i.id === e.over!.id);
      const rect = e.active.rect.current.translated;
      const mid = rect ? rect.top + rect.height / 2 : 0;
      rank = rankForDrop(list, Math.max(0, idx), mid > e.over.rect.top + e.over.rect.height / 2 ? "after" : "before");
    } else rank = rankForDrop(list, list.length - 1, "after");
    const fields: Record<string, unknown> = { rank };
    if (target !== issue.sprint_id) fields.sprint_id = target;
    void run([set("issue", issue.id, fields)]);
  };

  const sprintActions = (s: Sprint) => manage && (
    <>
      <button className="border border-edge px-2 py-0.5 text-xs hover:border-accent" onClick={() => setEditing(editing === s.id ? null : s.id)}>Edit</button>
      {s.state === "planned" && <button className="btn-px bg-accent px-2 py-0.5 text-xs font-semibold text-black" onClick={() => startSprint(s)}>Start sprint</button>}
      {s.state === "active" && <button className="btn-px bg-accent px-2 py-0.5 text-xs font-semibold text-black" onClick={() => completeSprint(s)}>Complete sprint</button>}
    </>
  );
  const dragged = dragging ? model.issueById.get(dragging) : undefined;

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={(e) => setDragging(String(e.active.id))} onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {manage && <button className="border border-edge px-3 py-1.5 text-sm hover:border-accent" onClick={addSprint}>+ Plan a sprint</button>}
          {editable && <button className="border border-edge px-3 py-1.5 text-sm hover:border-accent" onClick={() => newIssue({ project_id: project })}>+ Issue</button>}
          {!manage && <span className="text-xs text-ink-dim">Only the project lead, owners and admins run sprints.</span>}
        </div>
        {open.map((s) => (
          <Section key={s.id} id={s.id} disabled={!editable} issues={inSprint(s.id)}
            title={`${s.name}${s.state === "active" ? " · active" : ""}`}
            meta={`${fmtDate(s.start)} – ${fmtDate(s.end)}${s.goal ? ` · ${s.goal}` : ""}`}
            actions={sprintActions(s)}
          >
            {editing === s.id && <SprintEditor sprint={s} close={() => setEditing(null)} />}
          </Section>
        ))}
        <Section id="backlog" title="Backlog" disabled={!editable} issues={inSprint(null)} />
        {closed.length > 0 && (
          <div>
            <button className="text-xs text-ink-dim underline" onClick={() => setShowClosed(!showClosed)} aria-expanded={showClosed}>{showClosed ? "Hide" : "Show"} {closed.length} completed sprint{closed.length === 1 ? "" : "s"}</button>
            {showClosed && <ul className="mt-2 space-y-1 text-sm">
              {closed.map((s) => {
                const scope = issues.filter((i) => i.sprint_id === s.id);
                return <li key={s.id} className="border border-edge px-3 py-2">{s.name} · {fmtDate(s.start)} – {fmtDate(s.end)} · {scope.filter((i) => i.status === "done").length}/{scope.length} done</li>;
              })}
            </ul>}
          </div>
        )}
      </div>
      <DragOverlay>{dragged ? <div className="border border-accent bg-panel-2 px-3 py-1.5 text-sm">{issueKey(dragged, model.projectById)} {dragged.title}</div> : null}</DragOverlay>
    </DndContext>
  );
}
