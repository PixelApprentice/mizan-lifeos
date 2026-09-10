import { useEffect, useRef, useState } from "react";
import { dayInfo, type DayInfo } from "../lib/api";
import { STARTER_TEMPLATES, TEMPLATE_VARIABLES, renderTemplate, type NoteTemplate } from "../lib/workflows";
import { deleteNoteTemplate, listNoteTemplates, saveNoteTemplate } from "../lib/workflowStore";
import { useDialogFocus } from "./useDialogFocus";

export default function TemplateDialog({ date, close, insert }: { date: string; close: () => void; insert: (text: string) => void }) {
  const [custom, setCustom] = useState<NoteTemplate[]>([]);
  const [selected, setSelected] = useState(STARTER_TEMPLATES[0].id);
  const [name, setName] = useState(STARTER_TEMPLATES[0].name);
  const [body, setBody] = useState(STARTER_TEMPLATES[0].body);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [info, setInfo] = useState<DayInfo | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const lock = useRef(false);
  const ref = useDialogFocus(true);
  const templates = [...STARTER_TEMPLATES, ...custom];
  const isCustom = custom.some((template) => template.id === selected);
  const [time] = useState(() => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  let preview = "", previewError = "";
  if (info) {
    try { preview = renderTemplate(body, info, title, value, time); }
    catch (e) { previewError = String(e); }
  }
  useEffect(() => {
    let alive = true;
    Promise.all([listNoteTemplates(), dayInfo(date)]).then(([items, day]) => {
      if (alive) { setCustom(items); setInfo(day); }
    }).catch((e) => { if (alive) setError(String(e)); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [date]);
  const choose = (id: string) => {
    const template = templates.find((item) => item.id === id);
    if (!template) { setError("This template is no longer available."); return; }
    setSelected(id); setName(template.name); setBody(template.body); setDeleting(false); setStatus("");
  };
  const save = async (copy: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const template = { id: copy ? crypto.randomUUID() : selected, name, body };
      await saveNoteTemplate(template);
      setCustom((items) => [...items.filter((item) => item.id !== template.id), template]);
      setSelected(template.id); setStatus("Template saved in your local database.");
    } catch (e) { setError(String(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      await deleteNoteTemplate(selected);
      setCustom((items) => items.filter((item) => item.id !== selected));
      choose(STARTER_TEMPLATES[0].id); setStatus("Custom template deleted. Existing notes were not changed.");
    } catch (e) { setError(String(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Insert note template" className="panel max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5"
      onKeyDown={(e) => { if (e.key === "Escape" && !busy) close(); }}>
      <h3 className="font-bold">Insert note template</h3>
      <p className="my-2 text-xs text-ink-dim">Appends to {date}. Templates are plain text; scripts never run.</p>
      {error && <p role="alert" className="my-2 text-sm text-danger">{error}</p>}
      <fieldset disabled={busy} className="space-y-3">
        <label className="block text-sm">Template<select aria-label="Note template" value={selected} onChange={(e) => choose(e.target.value)} className="mt-1 block w-full border border-edge bg-panel-2 p-2">
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}{STARTER_TEMPLATES.includes(template) ? " (starter)" : ""}</option>)}
        </select></label>
        <label className="block text-sm">Title<input aria-label="Template title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 block w-full border border-edge bg-panel-2 p-2" /></label>
        <label className="block text-sm">Context<textarea aria-label="Template context" value={value} onChange={(e) => setValue(e.target.value)} rows={2} className="mt-1 block w-full border border-edge bg-panel-2 p-2" /></label>
        <details>
          <summary className="text-sm text-ink-dim">Customize & save locally</summary>
          <div className="mt-3 space-y-3">
            <label className="block text-xs">Template name<input aria-label="Template name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full border border-edge bg-panel-2 p-2" /></label>
            <label className="block text-xs">Template text<textarea aria-label="Template text" rows={6} value={body} onChange={(e) => setBody(e.target.value)} className="mt-1 block w-full border border-edge bg-panel-2 p-2" /></label>
            <p className="text-xs text-ink-dim break-words">Variables: {TEMPLATE_VARIABLES.map((key) => `{{${key}}}`).join(" · ")}</p>
            <div className="flex flex-wrap gap-2">
              <button disabled={!!previewError || !info} onClick={() => void save(true)} className="border border-edge px-3 py-2 text-xs">Save as new template</button>
              {isCustom && <><button disabled={!!previewError || !info} onClick={() => void save(false)} className="border border-edge px-3 py-2 text-xs">Update template</button>
                <button onClick={() => setDeleting(!deleting)} className="border border-danger px-3 py-2 text-xs text-danger">Delete template</button></>}
            </div>
            {deleting && <div className="flex flex-wrap items-center gap-2 text-xs"><span>Delete this custom template only?</span><button onClick={() => void remove()} className="border border-danger px-3 py-2 text-danger">Confirm delete</button><button onClick={() => setDeleting(false)} className="border border-edge px-3 py-2">Keep template</button></div>}
          </div>
        </details>
      </fieldset>
      {previewError ? <p role="alert" className="mt-3 text-sm text-danger">{previewError}</p> :
        <pre aria-label="Template preview" className="my-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words border border-edge bg-panel-2 p-3 text-xs">{preview}</pre>}
      <p role="status" className="text-xs text-ink-dim">{busy ? "Loading or saving..." : status}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button disabled={busy} onClick={close} className="border border-edge px-3 py-2 text-sm">Cancel</button>
        <button disabled={busy || !info || !!previewError || !preview.trim()} onClick={() => { insert(preview); close(); }} className="btn-px bg-accent px-4 py-2 text-sm font-bold text-black">Insert into log</button>
      </div>
    </div>
  </div>;
}
