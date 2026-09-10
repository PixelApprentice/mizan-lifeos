// Ctrl+K command palette — Notion-style quick actions and navigation.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

interface Cmd {
  label: string;
  hint: string;
  run: () => void;
}

export default function Palette({
  extra,
}: {
  extra?: Cmd[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const cmds: Cmd[] = useMemo(
    () => [
      { label: "Go: Today", hint: "day, checklist", run: () => nav("/") },
      { label: "Go: Planner", hint: "calendar, auto-plan", run: () => nav("/planner") },
      { label: "Go: Projects", hint: "kanban board", run: () => nav("/projects") },
      { label: "Go: Tasks", hint: "break down work", run: () => nav("/tasks") },
      { label: "Go: Focus", hint: "start deep mode", run: () => nav("/focus") },
      { label: "Go: Log", hint: "write today's log", run: () => nav("/log") },
      { label: "Go: Stats", hint: "streaks, charts", run: () => nav("/stats") },
      { label: "Go: Settings", hint: "blocklists, paths", run: () => nav("/settings") },
      ...(extra ?? []),
    ],
    [nav, extra],
  );

  const hits = cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        if (!open && document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        setOpen((o) => !o);
        setQ("");
        setSel(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    ref.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-[18vh]" onClick={() => setOpen(false)}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Command palette" className="panel w-[min(520px,90vw)] bg-panel" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const elements = panel.current?.querySelectorAll<HTMLElement>("input, button");
          if (!elements?.length) return;
          const first = elements[0], last = elements[elements.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }}>
        <input
          aria-label="Search commands"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={hits[sel] ? `command-${sel}` : undefined}
          ref={ref}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.max(0, Math.min(s + 1, hits.length - 1))); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter" && hits[sel]) {
              hits[sel].run();
              setOpen(false);
            }
          }}
          placeholder="> type a command…"
          className="w-full border-b border-edge bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div id="command-results" role="listbox" className="max-h-72 overflow-y-auto p-1">
          {hits.map((c, i) => (
            <button
              key={c.label}
              id={`command-${i}`}
              role="option"
              aria-selected={i === sel}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                c.run();
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                i === sel ? "bg-accent-dim text-accent" : "text-ink"
              }`}
            >
              {c.label}
              <span className="text-xs text-ink-dim">{c.hint}</span>
            </button>
          ))}
          {hits.length === 0 && <p className="px-3 py-2 text-sm text-ink-dim">no match</p>}
        </div>
      </div>
    </div>
  );
}
