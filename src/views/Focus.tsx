import { useEffect, useState } from "react";
import {
  focusEnd,
  focusPause,
  focusRemainingSec,
  focusStart,
  focusStatus,
  getSetting,
  setSetting,
  fmt12h,
  overlayHide,
  readSessions,
  todayStr,
  type FocusState,
} from "../lib/api";
import Modal, { type ModalRequest } from "../components/Modal";
import { PixelBar } from "../components/Pixel";

export default function Focus() {
  const [state, setState] = useState<FocusState | null>(null);
  const [presets, setPresets] = useState<number[]>([25, 50, 90]);
  const [minutes, setMinutes] = useState(50);
  const [intent, setIntent] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [modal, setModal] = useState<ModalRequest | null>(null);
  const [doneToday, setDoneToday] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSetting("focus_presets").then((v) => {
      const p = v.split(",").map(Number).filter((n) => n >= 5 && n <= 480);
      if (p.length) {
        setPresets(p);
        setMinutes(p[Math.floor(p.length / 2)]);
      }
    }).catch((e) => setError(String(e)));
    readSessions()
      .then((ss) => setDoneToday(ss.filter((s) => !s.broken && s.ended_at.startsWith(todayStr())).length))
      .catch((e) => setError(String(e)));
    const tick = () => {
      focusStatus().then(setState).catch((e) => setError(String(e)));
      setNow(Date.now());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const start = async () => {
    if (busy) return;
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) {
      setError("Choose a whole number of minutes between 5 and 480.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const sites = (await getSetting("blocked_sites")).split(",").map((s) => s.trim()).filter(Boolean);
      const apps = (await getSetting("blocked_apps")).split(",").map((s) => s.trim()).filter(Boolean);
      setState(await focusStart(minutes, sites, apps, intent));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    try {
      setState(await focusPause());
    } catch (e) {
      setError(String(e));
    }
  };

  const endEarly = () =>
    setModal({
      title: "Ending early = BROKEN session",
      body: "It goes in the log, the Friday review will see it, and sites stay blocked 5 more minutes. Type the honest reason.",
      input: { placeholder: "why are you breaking it? (min 5 chars)", minLen: 5 },
      confirmLabel: "Break session",
      danger: true,
      onConfirm: async (reason) => {
        await focusEnd(reason);
        await overlayHide();
        setState(await focusStatus());
      },
    });

  const editPresets = () =>
    setModal({
      title: "Edit session presets",
      body: "Comma-separated minutes, e.g. 25,50,90,120",
      input: { placeholder: presets.join(","), minLen: 1 },
      confirmLabel: "Save",
      onConfirm: async (v) => {
        const p = v.split(",").map(Number);
        if (!p.length || p.some((n) => !Number.isInteger(n) || n < 5 || n > 480)) throw new Error("Use whole minutes from 5 to 480, separated by commas.");
        await setSetting("focus_presets", p.join(","));
        setPresets(p);
      },
    });

  const remainingSec = state ? focusRemainingSec(state, now) : 0;
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, "0");
  const ss = String(remainingSec % 60).padStart(2, "0");
  const pct = state ? 1 - remainingSec / (state.planned_min * 60) : 0;
  const paused = !!state?.paused_at;

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-6 py-6">
      {state ? (
        state.broken_at ? (
          <div className="panel max-w-md p-8 text-center">
            <h2 className="text-2xl font-bold text-danger">session broken</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-dim">
              reason logged: “{state.broken_reason}”. sites stay blocked a few more minutes. the friday
              review will ask about this.
            </p>
          </div>
        ) : (
          <>
            <div className="relative flex h-72 w-72 items-center justify-center">
              <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
                <circle cx="50" cy="50" r="45" fill="none" stroke="#1e1e24" strokeWidth="5" />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke={paused ? "#82828c" : "#34d399"}
                  strokeWidth="5"
                  strokeLinecap="butt"
                  strokeDasharray={`${pct * 283} 283`}
                />
              </svg>
              <div className="text-center">
                <div className={`font-digits text-8xl leading-none ${paused ? "text-ink-dim" : ""}`}>
                  {mm}:{ss}
                </div>
                <div className={`mt-2 text-[10px] uppercase tracking-[0.3em] ${paused ? "text-ink-dim" : "text-accent"}`}>
                  {paused ? "paused — blocking stays on" : "deep mode"}
                </div>
              </div>
            </div>
            <PixelBar value={pct * 100} max={100} segments={30} color={paused ? "#82828c" : "var(--color-accent)"} className="w-72" />
            {state.intent && <p className="text-sm text-ink">❯ {state.intent}</p>}
            <p className="text-xs text-ink-dim">
              {fmt12h(state.started_at)} → {fmt12h(state.ends_at)} · {state.sites.length} sites ·{" "}
              {state.apps.length} apps · {state.kills} closes
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={togglePause}
                className="border border-edge px-5 py-2 text-sm text-ink-dim hover:text-ink"
              >
                {paused ? "▶ resume" : "⏸ pause timer"}
              </button>
              <button
                onClick={endEarly}
                className="border border-danger/40 px-4 py-2 text-sm text-danger hover:bg-danger/10"
              >
                end early (logged as broken)
              </button>
            </div>
          </>
        )
      ) : (
        <>
          <div className="text-center">
            <h2 className="cursor font-bold">deep mode</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-dim">
              Blocks the sites and apps you choose in Settings. The optional browser extension
              adds an intention gate. Early exits are recorded locally.
            </p>
            {doneToday > 0 && (
              <p className="mt-2 text-xs text-accent">
                {"✦".repeat(Math.min(doneToday, 8))} {doneToday} session{doneToday > 1 ? "s" : ""} completed today
              </p>
            )}
          </div>
          <input
            aria-label="Session goal"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="❯ what will this session produce?"
            className="w-full max-w-md border border-edge bg-panel px-4 py-3 text-sm outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center justify-center gap-2">
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => setMinutes(p)}
                aria-pressed={minutes === p}
                className={`border px-5 py-2.5 text-sm tabular-nums ${
                  minutes === p ? "border-accent bg-accent-dim text-accent" : "border-edge bg-panel text-ink-dim hover:text-ink"
                }`}
              >
                {p}′
              </button>
            ))}
            <input
              aria-label="Session duration in minutes"
              type="number"
              min={5}
              max={480}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="w-20 border border-edge bg-panel px-2 py-2.5 text-center text-sm"
            />
            <button onClick={editPresets} aria-label="Edit duration presets" className="px-2 text-xs text-ink-dim hover:text-ink" title="edit presets">
              ✎
            </button>
          </div>
          <button
            onClick={start}
            disabled={busy}
            className="btn-px bg-accent px-10 py-3.5 text-lg font-bold text-black hover:opacity-90"
          >
            {busy ? "Starting..." : "Begin session"}
          </button>
          <p className="text-[11px] text-ink-dim">timer lives in waybar · corner mini-window appears when waybar is hidden</p>
        </>
      )}
      {error && <p role="alert" className="max-w-md text-center text-sm text-danger">{error}</p>}
      <Modal req={modal} close={() => setModal(null)} />
    </div>
  );
}
