import { useEffect, useState, useSyncExternalStore } from "react";
import { focusStatus, IS_TAURI, type FocusState } from "./api";

interface Snapshot { state: FocusState | null; error: string; loading: boolean }
let snapshot: Snapshot = { state: null, error: "", loading: true };
const listeners = new Set<() => void>();
let pending: Promise<void> | null = null;
let cleanup: (() => void) | undefined;

export function refreshFocus(): Promise<void> {
  if (pending) return pending;
  pending = focusStatus().then((state) => {
    if (snapshot.loading || snapshot.error || JSON.stringify(state) !== JSON.stringify(snapshot.state)) {
      const changed = !snapshot.loading && JSON.stringify(state) !== JSON.stringify(snapshot.state);
      snapshot = { state, error: "", loading: false };
      listeners.forEach((listener) => listener());
      if (changed) window.dispatchEvent(new Event("mizan:focus-updated"));
    }
  }).catch((error: unknown) => {
    snapshot = { ...snapshot, error: `Cannot read focus status: ${String(error)}`, loading: false };
    listeners.forEach((listener) => listener());
  }).finally(() => { pending = null; });
  return pending;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const refresh = () => { void refreshFocus(); };
    const visible = () => { if (!document.hidden) refresh(); };
    const timer = setInterval(visible, 5000);
    window.addEventListener("mizan:focus-changed", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (IS_TAURI) {
      void import("@tauri-apps/api/event").then(({ listen }) => listen("mizan://focus-changed", refresh))
        .then((stop) => { if (disposed) stop(); else unlisten = stop; })
        .catch((error: unknown) => console.error("Cannot subscribe to focus changes", error));
    }
    refresh();
    cleanup = () => {
      disposed = true;
      clearInterval(timer);
      unlisten?.();
      window.removeEventListener("mizan:focus-changed", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { cleanup?.(); cleanup = undefined; }
  };
}

export function useFocus() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function useClock(active: boolean, interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => { if (!document.hidden) setNow(Date.now()); };
    tick();
    const timer = setInterval(tick, interval);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [active, interval]);
  return now;
}
