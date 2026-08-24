import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useCallback, useEffect, useState, type ComponentType, type SVGProps } from "react";
import {
  Sun,
  Notes,
  Calendar,
  Briefcase,
  CheckboxOn,
  Target,
  ChartBarBig,
  SettingsCog,
  Power,
  Menu,
} from "pixelarticons/react";
import { appQuit, focusRemainingSec, focusStatus, readTracker, todayStr, IS_TAURI, type FocusState } from "./lib/api";
import { currentStreak, scoreRow } from "./lib/score";
import Mascot, { type Mood } from "./components/Mascot";
import Palette from "./components/Palette";
import Modal, { type ModalRequest } from "./components/Modal";
import { Hearts, Logo } from "./components/Pixel";
import { flushBeforeExit } from "./lib/unsaved";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
interface NavItem {
  to: string;
  label: string;
  icon: Icon;
}

// Grouped so each part of the system has its own place: the day, planning, doing, reviewing.
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "day",
    items: [
      { to: "/", label: "today", icon: Sun },
      { to: "/log", label: "log", icon: Notes },
    ],
  },
  {
    label: "plan",
    items: [
      { to: "/planner", label: "planner", icon: Calendar },
      { to: "/projects", label: "projects", icon: Briefcase },
      { to: "/tasks", label: "tasks", icon: CheckboxOn },
    ],
  },
  { label: "do", items: [{ to: "/focus", label: "focus", icon: Target }] },
  { label: "review", items: [{ to: "/stats", label: "stats", icon: ChartBarBig }] },
  { label: "system", items: [{ to: "/settings", label: "settings", icon: SettingsCog }] },
];
const FLAT = GROUPS.flatMap((g) => g.items);

const isRunning = (f: FocusState | null) => !!f && !f.broken_at;

export default function App() {
  const nav = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState<FocusState | null>(null);
  const [streak, setStreak] = useState(0);
  const [todayScore, setTodayScore] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalRequest | null>(null);

  useEffect(() => {
    const tick = () => focusStatus().then(setFocus).catch((e) => setError(`Cannot read focus status: ${String(e)}`));
    tick();
    const id = setInterval(tick, 5000);
    const loadTracker = () =>
      readTracker()
        .then((rows) => {
          const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
          setStreak(currentStreak(sorted, (row) => row.fajr_on_time === "1", todayStr()));
          const t = sorted.find((r) => r.date === todayStr());
          setTodayScore(t ? scoreRow(t).score : null);
        })
        .catch((e) => setError(`Cannot read today's record: ${String(e)}`));
    loadTracker();
    window.addEventListener("mizan:tracker-saved", loadTracker);
    return () => {
      clearInterval(id);
      window.removeEventListener("mizan:tracker-saved", loadTracker);
    };
  }, []);

  // Alt+1-8 switches views without intercepting ordinary typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || !e.altKey || e.repeat) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const i = Number(e.key) - 1;
      if (Number.isInteger(i) && i >= 0 && i < FLAT.length) { e.preventDefault(); nav(FLAT[i].to); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  const askExit = useCallback(async () => {
    let f: FocusState | null;
    try {
      f = await focusStatus();
    } catch (e) {
      setError(`Cannot check the running session: ${String(e)}`);
      return;
    }
    const quit = async (reason?: string) => {
      await flushBeforeExit();
      if (!IS_TAURI) {
        setError("Browser preview cannot quit the desktop app. Close this browser tab instead.");
        return;
      }
      await appQuit(reason);
    };
    if (isRunning(f)) {
      setModal({
        title: "Exit during deep mode = BROKEN session",
        body: "Exiting stops everything now: the timer, site/app blocking, the corner window. The session is logged as broken. Type the honest reason.",
        input: { placeholder: "why are you exiting? (min 5 chars)", minLen: 5 },
        confirmLabel: "Exit Mizan",
        danger: true,
        onConfirm: (reason) => quit(reason),
      });
    } else {
      setModal({
        title: "Exit Mizan?",
        body: "Stops the timer, deep-mode blocking and all app windows. A separately installed permanent shield is managed in Settings.",
        confirmLabel: "Exit",
        danger: true,
        onConfirm: () => quit(),
      });
    }
  }, []);

  useEffect(() => { setNavOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setNavOpen(false); };
    const wide = window.matchMedia("(min-width: 1001px)");
    const resize = () => { if (wide.matches) setNavOpen(false); };
    window.addEventListener("keydown", close);
    wide.addEventListener("change", resize);
    return () => {
      window.removeEventListener("keydown", close);
      wide.removeEventListener("change", resize);
    };
  }, [navOpen]);

  // Window close button / Hyprland killactive during a session → same confirmation.
  useEffect(() => {
    if (!IS_TAURI) return;
    let un: (() => void) | undefined;
    let dead = false;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen("mizan://close-requested", () => askExit()).then((u) => (dead ? u() : (un = u))),
    );
    return () => {
      dead = true;
      un?.();
    };
  }, [askExit]);

  const mood: Mood = focus?.broken_at ? "warn" : focus ? "focus" : todayScore === 9 ? "celebrate" : "idle";
  const remaining = focus ? Math.ceil(focusRemainingSec(focus, Date.now()) / 60) : 0;
  let k = 0;

  return (
    <div className={`app-shell ${navOpen ? "nav-open" : ""}`}>
      <header className="compact-header">
        <button onClick={() => setNavOpen(!navOpen)} aria-expanded={navOpen} aria-controls="app-navigation" aria-label="Toggle navigation">
          <Menu className="px-icon h-5 w-5" />
        </button>
        <span className="font-pixel text-xs">MIZAN</span>
        <span className="text-sm text-ink-dim">{FLAT.find((n) => n.to === location.pathname)?.label}</span>
      </header>
      {navOpen && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
      <aside id="app-navigation" className="app-sidebar">
        <div className="flex items-center gap-3 px-5 pt-6 pb-2">
          <Logo size={3} />
          <div>
            <div className="font-pixel text-[13px] leading-none text-accent">MIZAN</div>
            <p className="mt-1.5 text-[10px] tracking-widest text-ink-dim">
              LifeOS{!IS_TAURI && " · browser preview"}
            </p>
          </div>
        </div>

        <nav aria-label="Main navigation" className="mt-1 flex flex-col px-3">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <div className="nav-group">{g.label}</div>
              <div className="flex flex-col gap-0.5">
                {g.items.map((n) => {
                  const key = String(++k);
                  const I = n.icon;
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      onClick={() => setNavOpen(false)}
                      end={n.to === "/"}
                      className={({ isActive }) =>
                        `group flex items-center gap-2.5 border-l-2 px-3 py-1.5 text-sm transition-colors ${
                          isActive
                            ? "border-accent bg-accent-dim text-accent"
                            : "border-transparent text-ink-dim hover:bg-panel-2 hover:text-ink"
                        }`
                      }
                    >
                      <I className="px-icon h-4 w-4" />
                      <span className="flex-1">{n.label}</span>
                      <kbd className="text-xs text-ink-faint" title={`Alt+${key}`}>{key}</kbd>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <p className="mt-3 px-6 text-[10px] text-ink-dim">
          ctrl+k <span className="text-ink-faint">→</span> command palette
        </p>

        <div className="mt-auto space-y-4 p-4">
          {focus && !focus.broken_at && (
            <div className="panel p-3 text-center">
              <div className="font-pixel-sm text-[10px] uppercase tracking-[0.25em] text-accent">
                {focus.paused_at ? "paused" : "deep mode"}
              </div>
              <div className="font-digits text-4xl leading-none">{remaining}′</div>
              {focus.intent && <div className="mt-0.5 truncate text-[10px] text-ink-dim">{focus.intent}</div>}
            </div>
          )}
          <details className="sidebar-companion">
            <summary className="text-xs text-ink-dim">Pixel companion</summary>
            <div className="space-y-3 pt-4"><Mascot mood={mood} streak={streak} />
            {todayScore !== null && <Hearts n={todayScore} />}</div>
          </details>
          <button
            onClick={askExit}
            className="flex w-full items-center justify-center gap-2 border border-danger/30 px-3 py-2 text-xs text-danger/80 hover:border-danger hover:bg-danger/10 hover:text-danger"
            title="quit completely — nothing keeps running"
          >
            <Power className="px-icon h-4 w-4" />
            <span className="font-pixel-sm">exit</span>
          </button>
        </div>
      </aside>

      <main id="main-content" className="app-content" inert={navOpen}>
        {error && <div role="alert" className="mb-4 flex items-center justify-between gap-3 border border-danger p-3 text-sm text-danger">
          {error}<button onClick={() => setError("")} aria-label="Dismiss error">Dismiss</button>
        </div>}
        <Outlet />
      </main>
      <Palette extra={[{ label: "Exit Mizan", hint: "quit completely", run: askExit }]} />
      <Modal req={modal} close={() => setModal(null)} />
    </div>
  );
}
