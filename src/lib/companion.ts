import { useEffect } from "react";
import { IS_TAURI } from "./api";

/** Edits synced from the phone arrive as a Tauri event; views listen for the window event. */
export function useCompanionBridge(report: (message: string) => void) {
  useEffect(() => {
    if (!IS_TAURI) return;
    let stop: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen("mizan://data-changed", () => window.dispatchEvent(new Event("mizan:data-changed"))))
      .then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; })
      .catch((error: unknown) => report(`Cannot receive phone changes: ${String(error)}`));
    return () => { disposed = true; stop?.(); };
  }, [report]);
}
