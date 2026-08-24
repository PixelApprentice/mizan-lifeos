// Corner overlay: semi-transparent ASCII mini-timer, pinned top-right by Hyprland rules.
// Rendered in its own tiny always-on-top window while a focus session runs.
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { focusRemainingSec, focusStatus, IS_TAURI, type FocusState } from "../lib/api";

const CAT = [String.raw`(>_<)`, String.raw`(>.o)`];
const CAT_PAUSED = [String.raw`(-.-)`, String.raw`(-.-)zZ`];

// Left-button press anywhere on the widget starts a window move. Explicit startDragging is
// more reliable on Wayland/webkitgtk than the data-tauri-drag-region attribute, which is
// what left the mini-window "un-draggable" before.
function startDrag(e: React.MouseEvent) {
  if (e.button !== 0 || !IS_TAURI) return;
  getCurrentWindow().startDragging().catch(() => {});
}

export default function Overlay() {
  const [state, setState] = useState<FocusState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [f, setF] = useState(0);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const tick = () => {
      focusStatus().then(setState).catch(() => {});
      setNow(Date.now());
      setF((v) => v + 1);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!state) {
    return (
      <div
        onMouseDown={startDrag}
        className="flex h-screen cursor-move items-center justify-center bg-black/55 text-xs text-ink-dim"
      >
        session ended
      </div>
    );
  }

  const rem = focusRemainingSec(state, now);
  const mm = String(Math.floor(rem / 60)).padStart(2, "0");
  const ss = String(rem % 60).padStart(2, "0");
  const paused = !!state.paused_at;
  const cat = paused ? CAT_PAUSED : CAT;

  return (
    <div
      onMouseDown={startDrag}
      className="flex h-screen cursor-move select-none flex-col items-center justify-center gap-0.5 border border-accent/30 bg-black/55 backdrop-blur-sm"
    >
      {/* pointer-events-none on the children so mousedown always lands on the drag container. */}
      <div className="pointer-events-none flex items-center gap-2">
        <pre className={`text-[10px] ${paused ? "text-ink-dim" : "text-accent"}`}>{cat[f % cat.length]}</pre>
        <span className={`text-2xl font-bold tabular-nums ${paused ? "text-ink-dim" : "text-ink"}`}>
          {mm}:{ss}
        </span>
      </div>
      <div className="pointer-events-none text-[8px] uppercase tracking-[0.25em] text-accent/80">
        {paused ? "paused" : "deep mode"}
      </div>
      {state.intent && (
        <div className="pointer-events-none max-w-[170px] truncate px-2 text-[8px] text-ink-dim">{state.intent}</div>
      )}
    </div>
  );
}
