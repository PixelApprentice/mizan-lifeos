import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "pixelarticons/react";
import { dayInfo, ensureDayLog, getSetting, readDayLog, todayStr, writeDayLog } from "../lib/api";
import { shiftDay } from "../lib/plan";
import { registerBeforeExit } from "../lib/unsaved";
import TemplateDialog from "../components/TemplateDialog";

const stamp = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const draftKey = (date: string, root: string) => `mizan:log-draft:${JSON.stringify([root, date])}`;

export default function Log() {
  const [date, setDate] = useState(todayStr());
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("Loading log...");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState("");
  const [ready, setReady] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const current = useRef<{ date: string; root: string; text: string; base: string } | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);

  const persistDraft = useCallback(() => {
    const state = current.current;
    if (!state) return;
    if (state.text === state.base) localStorage.removeItem(draftKey(state.date, state.root));
    else localStorage.setItem(draftKey(state.date, state.root), JSON.stringify(state));
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    while (saving.current) await saving.current;
    if (!current.current || current.current.text === current.current.base) return;
    const run = async () => {
      setMessage("Saving...");
      setError("");
      while (current.current && current.current.text !== current.current.base) {
        const state = current.current;
        const { date: day, text: snapshot, base } = state;
        const disk = await readDayLog(day);
        if (!disk.startsWith(base)) throw new Error("This log was edited elsewhere. Your draft is kept locally. Copy it before resolving the file conflict.");
        const suffix = disk.slice(base.length);
        const next = snapshot + suffix;
        await writeDayLog(day, next, disk);
        state.base = next;
        state.text += suffix;
        setContent(state.text);
        persistDraft();
      }
      setMessage(`Saved locally at ${stamp()}`);
    };
    const pending = run();
    saving.current = pending;
    try {
      await pending;
    } catch (e) {
      setError(`Save failed: ${String(e)}`);
      setMessage("Not saved");
      throw e;
    } finally {
      if (saving.current === pending) saving.current = null;
    }
  }, [persistDraft]);

  const load = useCallback(async (day: string) => {
    const version = ++generation.current;
    setBusy(true);
    setError("");
    setMessage("Loading log...");
    try {
      await ensureDayLog(day);
      let base = await readDayLog(day);
      const root = await getSetting("disc_path");
      if (version !== generation.current) return;
      let text = base;
      const raw = localStorage.getItem(draftKey(day, root));
      if (raw) {
        const draft: unknown = JSON.parse(raw);
        if (typeof draft !== "object" || draft === null || !("text" in draft) || !("base" in draft) ||
          typeof draft.text !== "string" || typeof draft.base !== "string") throw new Error("Invalid local draft. Its stored copy was not removed.");
        if (base.startsWith(draft.base)) text = draft.text + base.slice(draft.base.length);
        else {
          text = draft.text;
          base = draft.base;
          setError("Recovered draft conflicts with the file. Copy the text below and resolve the disk file before saving.");
        }
      }
      if (version !== generation.current) return;
      current.current = { date: day, root, text, base };
      setDate(day);
      setContent(text);
      setReady(true);
      setMessage(raw ? "Recovered a local draft. Press Save to file it." : "All changes saved");
    } catch (e) {
      if (version === generation.current) {
        setError(`Could not open log: ${String(e)}`);
        setMessage("");
      }
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    dayInfo().then((info) => { if (alive) return load(info.day < 1 ? info.day1 : todayStr()); })
      .catch((e) => { setError(String(e)); setBusy(false); });
    return () => { alive = false; generation.current++; if (timer.current) clearTimeout(timer.current); };
  }, [load]);

  useEffect(() => registerBeforeExit(flush), [flush]);
  useEffect(() => {
    const appended = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail !== current.current?.date) return;
      const refresh = async () => {
        while (saving.current) await saving.current;
        const state = current.current;
        if (!state) return;
        const base = state.base;
        const disk = await readDayLog(state.date);
        if (current.current !== state) return;
        if (saving.current || state.base !== base) { await refresh(); return; }
        if (!disk.startsWith(state.base)) throw new Error("The log changed elsewhere. Your draft is preserved; reopen the log after resolving the conflict.");
        state.text += disk.slice(state.base.length);
        state.base = disk;
        setContent(state.text);
        persistDraft();
      };
      void refresh().catch((e) => setError(String(e)));
    };
    window.addEventListener("mizan:log-appended", appended);
    return () => window.removeEventListener("mizan:log-appended", appended);
  }, [persistDraft]);
  const blocker = useBlocker(() => !!current.current && current.current.text !== current.current.base);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void flush().then(() => blocker.proceed(), () => blocker.reset());
  }, [blocker, flush]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (current.current && current.current.text !== current.current.base) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const keys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush().catch(() => { /* flush displays the error and keeps the draft. */ });
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("keydown", keys);
    };
  }, [flush]);

  const edit = (text: string) => {
    if (!current.current) return;
    current.current.text = text;
    setContent(text);
    setMessage("Unsaved changes");
    setError("");
    try { persistDraft(); } catch (e) { setError(`Local recovery draft unavailable: ${String(e)}. Save before leaving.`); }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => { /* Error is shown by flush. */ }); }, 1200);
  };

  const go = async (day: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { setError("Choose a valid date."); return; }
    setBusy(true);
    try { await flush(); await load(day); }
    catch { setBusy(false); } // flush has already surfaced the failure; do not leave the note.
  };

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-4">
      <header>
        <h2 className="cursor font-bold">Log</h2>
        <p className="mt-2 text-sm text-ink-dim">Plan ahead or reflect. Notes autosave to local Markdown; there is no future-day limit.</p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={busy} onClick={() => void go(shiftDay(date, -1))} aria-label="Previous day" className="border border-edge p-2"><ChevronLeft className="h-4 w-4" /></button>
        <input aria-label="Log date" type="date" value={date} disabled={busy} onChange={(e) => void go(e.target.value)} className="border border-edge bg-panel p-2" />
        <button disabled={busy} onClick={() => void go(shiftDay(date, 1))} aria-label="Next day" className="border border-edge p-2"><ChevronRight className="h-4 w-4" /></button>
        <button disabled={busy} onClick={() => void go(todayStr())} className="border border-edge px-3 py-2">Today</button>
        <button disabled={busy} onClick={() => void go(shiftDay(todayStr(), 1))} className="border border-edge px-3 py-2">Tomorrow</button>
      </div>
      {error && <p role="alert" className="border border-danger p-3 text-sm text-danger">{error}</p>}
      <textarea aria-label="Daily log" disabled={busy || !ready} value={content} onChange={(e) => edit(e.target.value)}
        className="min-h-80 flex-1 resize-y border border-edge bg-panel p-4 text-sm leading-relaxed" spellCheck={false} />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy || !ready} onClick={() => void flush().catch(() => { /* Displayed above. */ })} className="btn-px bg-accent px-4 py-2 font-bold text-black">Save log</button>
        <button disabled={busy || !ready} onClick={() => setTemplatesOpen(true)} className="border border-edge px-3 py-2 text-sm">Insert template</button>
        <span role="status" className="text-xs text-ink-dim">{busy ? "Loading..." : message}</span>
        {templatesOpen && <TemplateDialog date={date} close={() => setTemplatesOpen(false)} insert={(text) => edit(`${current.current?.text ?? ""}\n\n${text}\n`)} />}
      </div>
      <details className="panel p-3">
        <summary className="text-sm">Quick timestamped note</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <input aria-label="Quick note" value={note} onChange={(e) => setNote(e.target.value)} className="min-w-0 flex-1 border border-edge bg-panel-2 p-2" />
          <button disabled={busy || !ready || !note.trim()} onClick={() => {
            edit(`${current.current?.text ?? ""}\n- ${stamp()}: ${note.trim()}\n`);
            setNote("");
            void flush().catch(() => { /* Displayed above. */ });
          }} className="border border-edge px-3 py-2">Append note</button>
        </div>
      </details>
    </div>
  );
}
