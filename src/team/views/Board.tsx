// Team board: one column per status. Drag a card to reorder it or move it to another
// status; the move is a single op (new rank + status), so teammates never fight over order.
import { useMemo, useState } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { set } from "../api";
import { STATUSES, can, filterIssues, issueKey, statusFields, type Issue, type StatusId } from "../model";
import { rankForDrop } from "../rank";
import { Avatar, Empty, PriorityMark, TypeMark, fmtDate, inlineCls, useWs } from "./ui";

const collision: CollisionDetection = (args) => {
  const hits = args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);
  const types = new Map(args.droppableContainers.map((c) => [c.id, c.data.current?.type]));
  const cards = hits.filter((h) => types.get(h.id) === "card");
  return cards.length ? cards : hits;
};

function CardBody({ issue }: { issue: Issue }) {
  const { model } = useWs();
  const done = issue.checklist.filter((c) => c.done).length;
  const overdue = issue.due && issue.status !== "done" && issue.due.slice(0, 10) < new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-ink-dim">
        <TypeMark type={issue.type} />
        <span>{issueKey(issue, model.projectById)}</span>
        {issue._pending && <span title="Waiting to sync" className="text-gold">•</span>}
        <span className="ml-auto"><PriorityMark value={issue.priority} /></span>
      </div>
      <p className={`leading-snug ${issue.status === "done" ? "text-ink-dim line-through" : ""}`}>{issue.title}</p>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-dim">
        {issue.labels.slice(0, 2).map((l) => <span key={l} className="border border-edge px-1">{l}</span>)}
        {issue.checklist.length > 0 && <span>☑ {done}/{issue.checklist.length}</span>}
        {issue.due && <span className={overdue ? "text-danger" : ""}>{fmtDate(issue.due)}</span>}
        {issue.estimate !== null && <span title="Estimate">{issue.estimate}</span>}
        <span className="ml-auto"><Avatar model={model} id={issue.assignee} /></span>
      </div>
    </>
  );
}

function Card({ issue, disabled }: { issue: Issue; disabled?: boolean }) {
  const { model, openIssue } = useWs();
  const drag = useDraggable({ id: issue.id, data: { type: "card" }, disabled });
  const drop = useDroppable({ id: issue.id, data: { type: "card", status: issue.status } });
  return (
    <div
      ref={(el) => { drag.setNodeRef(el); drop.setNodeRef(el); }}
      {...drag.attributes}
      {...drag.listeners}
      onClick={() => openIssue(issue.id)}
      onKeyDown={(e) => { if (e.key === "Enter") openIssue(issue.id); else drag.listeners?.onKeyDown?.(e); }}
      aria-label={`${issueKey(issue, model.projectById)} ${issue.title}. Press space to pick up, Enter to open.`}
      className={`group cursor-grab border bg-panel-2 p-2.5 text-sm transition-colors hover:border-accent/60 ${drag.isDragging ? "opacity-30" : ""} ${drop.isOver ? "border-accent" : "border-edge"} ${issue._pending ? "border-dashed" : ""}`}
    >
      <CardBody issue={issue} />
    </div>
  );
}

function Column({ id, label, issues, readOnly }: { id: StatusId; label: string; issues: Issue[]; readOnly: boolean }) {
  const { newIssue, project } = useWs();
  const { setNodeRef, isOver } = useDroppable({ id: `col:${id}`, data: { type: "column", status: id } });
  return (
    <section ref={setNodeRef} aria-label={`${label}, ${issues.length} issues`} className={`flex w-64 shrink-0 flex-col border bg-panel ${isOver ? "border-accent" : "border-edge"}`}>
      <header className="flex items-center gap-2 border-b border-edge px-3 py-2 text-xs">
        <span className="font-pixel-sm uppercase">{label}</span>
        <span className="text-ink-dim">{issues.length}</span>
        {!readOnly && <button className="ml-auto text-ink-dim hover:text-accent" aria-label={`New issue in ${label}`} onClick={() => newIssue({ status: id, project_id: project || undefined })}>+</button>}
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {issues.map((i) => <Card key={i.id} issue={i} disabled={readOnly} />)}
      </div>
    </section>
  );
}

export default function Board() {
  const { model, project, run } = useWs();
  const [text, setText] = useState("");
  const [who, setWho] = useState("");
  const [showDone, setShowDone] = useState(true);
  const activeSprint = model.sprints.find((s) => s.state === "active" && (!project || s.project_id === project));
  const [sprintOnly, setSprintOnly] = useState(true);
  const [dragging, setDragging] = useState<string | null>(null);
  const readOnly = !can(model, "edit-issues");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const scoped = useMemo(() => {
    let list = model.issues.filter((i) => !project || i.project_id === project);
    if (activeSprint && sprintOnly) list = list.filter((i) => i.sprint_id === activeSprint.id);
    return filterIssues(list, { text, assignee: who || undefined }, model.projectById);
  }, [model, project, activeSprint, sprintOnly, text, who]);

  const columns = STATUSES.filter((s) => s.id !== "canceled" && (showDone || s.id !== "done"));
  const byStatus = (s: string) => scoped.filter((i) => i.status === s);

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const issue = model.issueById.get(String(e.active.id));
    if (!issue || !e.over) return;
    const overData = e.over.data.current as { type: string; status: StatusId } | undefined;
    if (!overData) return;
    const status = overData.status;
    const list = byStatus(status).filter((i) => i.id !== issue.id);
    let rank: string;
    if (overData.type === "card") {
      if (e.over.id === issue.id) return;
      const idx = list.findIndex((i) => i.id === e.over!.id);
      const rect = e.active.rect.current.translated;
      const mid = rect ? rect.top + rect.height / 2 : 0;
      const placement = mid > e.over.rect.top + e.over.rect.height / 2 ? "after" : "before";
      rank = rankForDrop(list, Math.max(0, idx), placement);
    } else {
      rank = rankForDrop(list, list.length - 1, "after");
    }
    const fields: Record<string, unknown> = { rank };
    if (status !== issue.status) Object.assign(fields, statusFields(issue, status));
    void run([set("issue", issue.id, fields)]);
  };

  const people = [...model.members.values()].filter((m) => m.active);
  const draggingIssue = dragging ? model.issueById.get(dragging) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input aria-label="Filter issues" placeholder="Filter…" className={`${inlineCls} max-w-56`} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex items-center gap-1" role="group" aria-label="Filter by person">
          {people.map((m) => (
            <button key={m.id} aria-pressed={who === m.id} onClick={() => setWho(who === m.id ? "" : m.id)} className={`rounded-full p-0.5 ${who === m.id ? "ring-2 ring-accent" : "opacity-80 hover:opacity-100"}`}>
              <Avatar model={model} id={m.id} size={22} />
            </button>
          ))}
        </div>
        {activeSprint && (
          <label className="flex items-center gap-1.5 text-xs text-ink-dim">
            <input type="checkbox" checked={sprintOnly} onChange={(e) => setSprintOnly(e.target.checked)} /> {activeSprint.name} only
          </label>
        )}
        <label className="flex items-center gap-1.5 text-xs text-ink-dim">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> show done
        </label>
        {readOnly && <span className="text-xs text-gold">View only</span>}
      </div>
      {!model.projects.length ? (
        <Empty>No projects yet. Create one in the Settings tab, then add issues.</Empty>
      ) : (
        <DndContext sensors={sensors} collisionDetection={collision} onDragStart={(e: DragStartEvent) => setDragging(String(e.active.id))} onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd}>
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
            {columns.map((c) => <Column key={c.id} id={c.id} label={c.label} issues={byStatus(c.id)} readOnly={readOnly} />)}
          </div>
          <DragOverlay>{draggingIssue ? <div className="w-60 rotate-1 border border-accent bg-panel-2 p-2.5 text-sm shadow-lg"><CardBody issue={draggingIssue} /></div> : null}</DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
