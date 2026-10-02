import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  focusEnd,
  focusPause,
  focusRemainingSec,
  focusStart,
  getSetting,
  setSetting,
  fmt12h,
  readSessions,
  todayStr,
} from "../lib/api";
import Modal, { type ModalRequest } from "../components/Modal";
import { PixelBar } from "../components/Pixel";
import DurationWheel from "../components/DurationWheel";
import { refreshFocus, useClock, useFocus } from "../lib/focusStore";
import { create, edit as teamEdit, team, type MyIssue } from "../team/api";

// A focus session can be tied to a team issue; when it ends, offer to log the time there.
const TEAM_LINK = "mizan.focus.team-issue";
interface TeamLink { ws: string; id: string; key: string; title: string; started: string }
const readLink = (): TeamLink | null => { try { return JSON.parse(localStorage.getItem(TEAM_LINK) ?? "null"); } catch { return null; } };

export default function Focus() {
  const { state, loading } = useFocus();
  const [presets, setPresets] = useState<number[]>([25, 50, 90]);
  const [minutes, setMinutes] = useState(50);
  const [intent, setIntent] = useState("");
  const [error, setError] = useState("");
  const now = useClock(!!state && !state.paused_at && !state.broken_at);
  const [modal, setModal] = useState<ModalRequest | null>(null);
  const [doneToday, setDoneToday] = useState(0);
  const [busy, setBusy] = useState(false);
  const [wheel, setWheel] = useState(() => localStorage.getItem("mizan:focus-wheels") !== "0");
  const [teamIssues, setTeamIssues] = useState<MyIssue[]>([]);
  const [teamPick, setTeamPick] = useState("");
  const [logOffer, setLogOffer] = useState<{ link: TeamLink; minutes: number } | null>(null);
  const [logNote, setLogNote] = useState("");
  const [params, setParams] = useSearchParams();
  const linked = useRef(false);

  // "Focus on this" from a task opens /focus?goal=…&min=…
  useEffect(() => {
    const goal = params.get("goal");
    const min = Number(params.get("min"));
    if (!goal && !min) return;
    if (goal) setIntent(goal.slice(0, 200));
    if (Number.isInteger(min) && min >= 5 && min <= 480) { setMinutes(min); linked.current = true; }
    setParams({}, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    getSetting("focus_presets").then((v) => {
      const p = [...new Set(v.split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 5 && n <= 480))];
      if (p.length) {
        setPresets(p);
        if (!linked.current) setMinutes(p[Math.floor(p.length / 2)]);
      }
    }).catch((e) => setError(String(e)));
    const sessions = () => {
      void readSessions().then((ss) => setDoneToday(ss.filter((s) => {
        const date = new Date(s.ended_at);
        const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        return !s.broken && local === todayStr();
      }).length)).catch((e) => setError(String(e)));
    };
    sessions();
    team.myIssues().then(setTeamIssues).catch(() => setTeamIssues([]));
    window.addEventListener("mizan:focus-updated", sessions);
    return () => window.removeEventListener("mizan:focus-updated", sessions);
  }, []);

  useEffect(() => {
    if (loading || state) return;
    const link = readLink();
    if (!link) return;
    void readSessions().then((ss) => {
      const since = Date.parse(link.started) - 60_000;
      const session = ss.filter((x) => Date.parse(x.started_at) >= since).sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
      if (session && session.actual_min >= 1) setLogOffer({ link, minutes: Math.min(1440, Math.round(session.actual_min)) });
      else if (Date.now() - Date.parse(link.started) > 86_400_000) localStorage.removeItem(TEAM_LINK);
    }).catch(() => undefined);
  }, [loading, state]);

  const logToTeam = async () => {
    if (!logOffer) return;
    const { link, minutes: m } = logOffer;
    try {
      await teamEdit(link.ws, [create("worklog", { issue_id: link.id, minutes: m, date: todayStr(), note: "Focus session", created_at: new Date().toISOString() })]);
      setLogNote(`Logged ${m} min to ${link.key}.`);
      localStorage.removeItem(TEAM_LINK);
      setLogOffer(null);
    } catch (e) {
      setError(`Could not log time to ${link.key}: ${String(e)}`);
    }
  };

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
      const picked = teamIssues.find((i) => `${i.ws}/${i.id}` === teamPick);
      if (picked) localStorage.setItem(TEAM_LINK, JSON.stringify({ ws: picked.ws, id: picked.id, key: picked.key, title: picked.title, started: new Date().toISOString() } satisfies TeamLink));
      else localStorage.removeItem(TEAM_LINK);
      await focusStart(minutes, sites, apps, intent || (picked ? `${picked.key} ${picked.title}` : ""));
      await refreshFocus();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await focusPause();
      await refreshFocus();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
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
        await refreshFocus();
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
        setPresets([...new Set(p)]);
      },
    });

  const remainingSec = state ? focusRemainingSec(state, now) : 0;
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, "0");
  const ss = String(remainingSec % 60).padStart(2, "0");
  const pct = state ? 1 - remainingSec / (state.planned_min * 60) : 0;
  const paused = !!state?.paused_at;

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-6 py-6">
      {loading ? <p role="status">Loading focus timer...</p> : state ? (
        state.broken_at ? (
          <div className="panel max-w-md p-8 text-center">
            <h2 className="text-2xl font-bold text-danger">Session ended early</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-dim">
              Reason logged: “{state.broken_reason}”. Sites stay blocked for a few more minutes, and
              your weekly review will bring this up.
            </p>
          </div>
        ) : (
          <>
            <div className="relative flex h-72 w-72 items-center justify-center">
              <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
                <circle cx="50" cy="50" r="45" fill="none" style={{ stroke: "var(--color-edge)" }} strokeWidth="5" />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  style={{ stroke: paused ? "var(--color-ink-faint)" : "var(--color-accent)" }}
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
            <PixelBar value={pct * 100} max={100} segments={30} color={paused ? "var(--color-ink-faint)" : "var(--color-accent)"} className="w-72" />
            {state.intent && <p className="text-sm text-ink">❯ {state.intent}</p>}
            <p className="text-xs text-ink-dim">
              {fmt12h(state.started_at)} → {fmt12h(state.ends_at)} · {state.sites.length} sites ·{" "}
              {state.apps.length} apps · {state.kills} closes{state.phone_leaves ? ` · ${state.phone_leaves} phone checks` : ""}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={togglePause}
                disabled={busy}
                className="border border-edge px-5 py-2 text-sm text-ink-dim hover:text-ink"
              >
                {paused ? "Resume timer" : "Pause timer"}
              </button>
              <button
                onClick={endEarly}
                disabled={busy}
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
            <h2 className="cursor font-bold">Deep focus</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-dim">
              Blocks the sites and apps you choose in Settings. The optional browser extension
              adds an intention gate. Early exits are recorded locally.
            </p>
            {doneToday > 0 && (
              <p className="mt-2 text-xs text-accent">
                {doneToday} session{doneToday > 1 ? "s" : ""} completed today
              </p>
            )}
          </div>
          {logOffer && (
            <div className="panel flex w-full max-w-md flex-wrap items-center gap-3 p-3 text-sm">
              <span className="flex-1">Log {logOffer.minutes} min to <b>{logOffer.link.key}</b> {logOffer.link.title}?</span>
              <button onClick={logToTeam} className="btn-px bg-accent px-3 py-1 text-xs font-bold text-black">Log time</button>
              <button onClick={() => { localStorage.removeItem(TEAM_LINK); setLogOffer(null); }} className="border border-edge px-3 py-1 text-xs">Skip</button>
            </div>
          )}
          {logNote && <p role="status" className="text-xs text-accent">{logNote}</p>}
          <input
            aria-label="Session goal"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="❯ what will this session produce?"
            className="w-full max-w-md border border-edge bg-panel px-4 py-3 text-sm outline-none focus:border-accent"
          />
          {teamIssues.length > 0 && (
            <select aria-label="Team issue for this session" value={teamPick} onChange={(e) => setTeamPick(e.target.value)} className="w-full max-w-md border border-edge bg-panel px-3 py-2 text-sm text-ink-dim">
              <option value="">No team issue (personal session)</option>
              {teamIssues.map((i) => <option key={`${i.ws}/${i.id}`} value={`${i.ws}/${i.id}`}>{i.key} · {i.title} · {i.ws_name}</option>)}
            </select>
          )}
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
              Edit
            </button>
          </div>
          <button aria-expanded={wheel} onClick={() => { localStorage.setItem("mizan:focus-wheels", wheel ? "0" : "1"); setWheel(!wheel); }} className="border border-edge px-4 py-2 text-sm">
            {wheel ? "Hide wheels" : "Choose with wheels"}
          </button>
          {wheel && <DurationWheel minutes={minutes} change={setMinutes} />}
          <button
            onClick={start}
            disabled={busy}
            className="btn-px bg-accent px-10 py-3.5 text-lg font-bold text-black hover:opacity-90"
          >
            {busy ? "Starting..." : "Begin session"}
          </button>
          <p className="max-w-md text-center text-xs text-ink-dim">The timer stays here and in the sidebar. Turn on Phone companion in Settings to use your phone as a full-screen second display.</p>
        </>
      )}
      {error && <p role="alert" className="max-w-md text-center text-sm text-danger">{error}</p>}
      <Modal req={modal} close={() => setModal(null)} />
    </div>
  );
}
