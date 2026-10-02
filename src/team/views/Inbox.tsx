// Inbox: assignments, mentions, comments and status changes on my issues, newest first.
import { useEffect, useMemo, useState } from "react";
import { inbox } from "../inbox";
import { Avatar, Empty, ago, useWs } from "./ui";

const KIND = { assigned: "Assigned", mention: "Mention", comment: "Comment", status: "Status" } as const;

export default function Inbox() {
  const { ws, model, openIssue } = useWs();
  const key = `mizan.team.inbox-read.${ws}`;
  const [readUpTo, setReadUpTo] = useState(() => Number(localStorage.getItem(key) ?? 0));
  const items = useMemo(() => inbox(model), [model]);
  const newest = items[0]?.seq ?? 0;
  useEffect(() => setReadUpTo(Number(localStorage.getItem(key) ?? 0)), [key]);
  const markRead = () => { localStorage.setItem(key, String(newest)); setReadUpTo(newest); };
  if (!items.length) return <Empty>Nothing new. Assignments, @mentions and updates on your issues land here.</Empty>;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink-dim">{items.filter((i) => i.seq > readUpTo).length} unread</span>
        <button className="ml-auto border border-edge px-3 py-1 text-xs hover:border-accent" onClick={markRead}>Mark all read</button>
      </div>
      <ul className="divide-y divide-edge/60 border border-edge">
        {items.map((i) => (
          <li key={i.seq}>
            <button onClick={() => openIssue(i.issueId)} className={`flex w-full items-start gap-3 px-3 py-2 text-left text-sm hover:bg-panel-2 ${i.seq > readUpTo ? "" : "opacity-60"}`}>
              <Avatar model={model} id={i.member} />
              <span className="flex-1">
                <span className="mr-2 text-[10px] uppercase tracking-widest text-accent">{KIND[i.kind]}</span>
                {i.text}
              </span>
              <span className="shrink-0 text-xs text-ink-dim">{ago(i.at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

