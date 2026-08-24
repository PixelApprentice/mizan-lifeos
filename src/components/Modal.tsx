// In-app modal replacing window.prompt/confirm, which Tauri's Linux webview does not implement.
import { useEffect, useRef, useState } from "react";

export interface ModalRequest {
  title: string;
  body?: string;
  input?: { placeholder: string; minLen?: number };
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (value: string) => void | Promise<void>;
  onCancel?: () => void;
}

export default function Modal({ req, close }: { req: ModalRequest | null; close: () => void }) {
  const [value, setValue] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const lock = useRef(false);

  useEffect(() => {
    setValue("");
    setBad(false);
    setError("");
    setBusy(false);
    if (!req) return;
    const previous = document.activeElement;
    (ref.current ?? panel.current)?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, [req]);

  if (!req) return null;

  const confirm = async () => {
    if (lock.current) return;
    if (req.input && value.trim().length < (req.input.minLen ?? 1)) {
      setBad(true);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await req.onConfirm(value.trim());
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const cancel = () => {
    if (lock.current) return;
    req.onCancel?.();
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={cancel}>
      <div
        className="panel w-[min(480px,90vw)] bg-panel p-6"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-heading"
        aria-busy={busy}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) { e.preventDefault(); void confirm(); }
          if (e.key === "Escape") cancel();
          if (e.key === "Tab") {
            const elements = panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
            if (!elements?.length) { e.preventDefault(); return; }
            const first = elements[0], last = elements[elements.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
              e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault(); first.focus();
            }
          }
        }}
      >
        <h3 id="confirmation-heading" className={`mb-2 font-bold ${req.danger ? "text-danger" : "text-accent"}`}>{req.title}</h3>
        {req.body && <p className="mb-4 text-sm leading-relaxed text-ink-dim">{req.body}</p>}
        {req.input && (
          <input
            ref={ref}
            disabled={busy}
            aria-label={req.input.placeholder}
            aria-invalid={bad}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setBad(false);
            }}
            placeholder={req.input.placeholder}
            className={`mb-4 w-full border bg-panel-2 px-3 py-2 text-sm outline-none ${
              bad ? "border-danger" : "border-edge focus:border-accent"
            }`}
          />
        )}
        {bad && <p role="alert" className="mb-4 text-sm text-danger">Enter at least {req.input?.minLen ?? 1} characters.</p>}
        {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button disabled={busy} onClick={cancel} className="border border-edge px-4 py-2 text-sm text-ink-dim hover:bg-panel-2">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className={`btn-px px-4 py-2 text-sm font-semibold text-black ${req.danger ? "danger bg-danger" : "bg-accent"}`}
          >
            {busy ? "Working..." : req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
