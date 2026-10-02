// Settings → Daily routine: pick a preset or shape your own check-in items and targets.
import { useEffect, useState } from "react";
import { FAITH, GENERAL, keyFor, maxScore, type Routine, type RoutineItem, type RoutineType } from "../lib/routine";
import { loadRoutine, saveRoutine } from "../lib/useRoutine";

const TYPES: { id: RoutineType; label: string }[] = [
  { id: "bool", label: "Checkbox" },
  { id: "min", label: "Minutes" },
  { id: "count", label: "Count" },
  { id: "number", label: "Number (not scored)" },
];
const cls = "border border-edge bg-panel-2 px-2 py-1 text-sm outline-none focus:border-accent";
const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.min(100000, Math.round(Number(v)) || 0)));

export default function RoutineSettings() {
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { loadRoutine().then(setRoutine).catch((e) => setError(String(e))); }, []);
  if (!routine) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : null;

  const update = (next: Routine) => { setRoutine(next); setNote(""); setDirty(true); };
  const edit = (i: number, patch: Partial<RoutineItem>) =>
    update({ ...routine, preset: "custom", scoring: "items", items: routine.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
  const move = (i: number, d: -1 | 1) => {
    const items = [...routine.items];
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    update({ ...routine, items });
  };
  const add = () => {
    const text = label.trim();
    if (!text) return;
    update({ ...routine, preset: "custom", scoring: "items", items: [...routine.items, { key: keyFor(text, routine.items.map((i) => i.key)), label: text.slice(0, 80), type: "bool", scored: true }] });
    setLabel("");
  };
  const save = async () => {
    setError("");
    try { await saveRoutine(routine); setNote("Routine saved. Today and Stats use it now."); setDirty(false); } catch (e) { setError(String(e)); }
  };

  return (
    <details className="panel p-4">
      <summary className="font-bold">Daily routine · {routine.items.length} items · scored out of {maxScore(routine)}</summary>
      <div className="space-y-4 pt-4">
        <p className="text-[11px] text-ink-dim">What you check in on Today each evening. Past check-ins keep their values when you change this; new items get their own column in tracker.csv.</p>
        <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="Routine preset">
          <button className={`border px-3 py-1.5 ${routine.preset === "general" ? "border-accent text-accent" : "border-edge"}`} onClick={() => update(GENERAL)}>General</button>
          <button className={`border px-3 py-1.5 ${routine.preset === "faith" ? "border-accent text-accent" : "border-edge"}`} onClick={() => update(FAITH)}>Faith &amp; study (original)</button>
          {routine.preset === "custom" && <span className="border border-accent px-3 py-1.5 text-accent">Custom</span>}
        </div>
        {routine.scoring === "classic" && <p className="text-[11px] text-ink-dim">This preset uses its original 9-point rules (prayers together, consume ≤ ⅓ of build, log and money together). Editing an item switches to per-item scoring.</p>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={routine.showPrayers} onChange={(e) => update({ ...routine, showPrayers: e.target.checked })} /> Show prayer times on Today
        </label>
        <ul className="space-y-2">
          {routine.items.map((it, i) => (
            <li key={it.key} className="flex flex-wrap items-center gap-2 border border-edge/60 p-2">
              <input aria-label="Item name" className={`${cls} min-w-40 flex-1`} value={it.label} maxLength={80} onChange={(e) => edit(i, { label: e.target.value })} />
              <select aria-label={`${it.label} type`} className={cls} value={it.type} onChange={(e) => edit(i, { type: e.target.value as RoutineType })}>
                {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              {(it.type === "min" || it.type === "count") && <>
                <input aria-label={`${it.label} weekday target`} title="Weekday target" placeholder="weekday" className={`${cls} w-20`} inputMode="numeric" value={it.weekday ?? ""} onChange={(e) => edit(i, { weekday: num(e.target.value) })} />
                <input aria-label={`${it.label} weekend target`} title="Weekend target (blank = same)" placeholder="weekend" className={`${cls} w-20`} inputMode="numeric" value={it.weekend ?? ""} onChange={(e) => edit(i, { weekend: num(e.target.value) })} />
              </>}
              {it.type !== "number" && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={it.scored} onChange={(e) => edit(i, { scored: e.target.checked })} /> scored</label>}
              <span className="ml-auto flex gap-1">
                <button aria-label={`Move ${it.label} up`} className="border border-edge px-2 text-xs" onClick={() => move(i, -1)}>↑</button>
                <button aria-label={`Move ${it.label} down`} className="border border-edge px-2 text-xs" onClick={() => move(i, 1)}>↓</button>
                <button aria-label={`Remove ${it.label}`} className="border border-edge px-2 text-xs hover:border-danger" onClick={() => update({ ...routine, preset: "custom", scoring: "items", items: routine.items.filter((_, k) => k !== i) })}>✕</button>
              </span>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input aria-label="New routine item" placeholder="Add a habit, e.g. Drink 2 L of water" className={`${cls} flex-1`} value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className="border border-edge px-3 text-sm">Add</button>
        </form>
        <div className="flex items-center gap-3">
          <button className="btn-px bg-accent px-4 py-2 text-sm font-bold text-black" disabled={!routine.items.length} onClick={save}>Save routine</button>
          {dirty && !note && <span className="text-xs text-gold">Unsaved changes</span>}
          {note && <span role="status" className="text-xs text-accent">{note}</span>}
          {error && <span role="alert" className="text-xs text-danger">{error}</span>}
        </div>
      </div>
    </details>
  );
}
