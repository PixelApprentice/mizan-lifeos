import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
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
  Users,
} from "pixelarticons/react";
import { appQuit, focusRemainingSec, focusStatus, IS_TAURI, type FocusState } from "./lib/api";
import Palette from "./components/Palette";
import Modal, { type ModalRequest } from "./components/Modal";
import { Logo } from "./components/Pixel";
import { flushBeforeExit } from "./lib/unsaved";
import QuickCapture from "./components/QuickCapture";
import { useClock, useFocus } from "./lib/focusStore";
import { useCompanionBridge } from "./lib/companion";
import { useWorkspaces } from "./team/api";

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
  { label: "team", items: [{ to: "/team", label: "workspaces", icon: Users }] },
  { label: "system", items: [{ to: "/settings", label: "settings", icon: SettingsCog }] },
];
const FLAT = GROUPS.flatMap((g) => g.items);

/** Team workspaces under the "team" group, so each one is a click away. */
function TeamNav({ close }: { close: () => void }) {
  const { list } = useWorkspaces();
  const { pathname } = useLocation();
  return <>
    {list?.map((w) => (
      <NavLink key={w.id} to={`/team/${w.id}/board`} onClick={close}
        className={() => `truncate border-l-2 py-1 pl-9 pr-3 text-xs ${pathname.startsWith(`/team/${w.id}`) ? "border-accent text-accent" : "border-transparent text-ink-dim hover:bg-panel-2 hover:text-ink"}`}>
        {w.name}{w.pending > 0 ? ` · ${w.pending}` : ""}
      </NavLink>
    ))}
  </>;
}

const isRunning = (f: FocusState | null) => !!f && !f.broken_at;

/** A crash in one view shows a readable message instead of killing the whole window. */
class ViewErrorBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: "" };
  static getDerivedStateFromError(error: unknown) {
    return { message: String(error) };
  }
  componentDidCatch(error: Error) {
    console.error("Mizan view failed", error);
  }
  render() {
    if (!this.state.message) return this.props.children;
    return (
      <div role="alert" className="panel space-y-3 p-5">
        <h2 className="font-bold text-danger">This view hit an error</h2>
        <p className="break-words text-sm text-ink-dim">{this.state.message}</p>
        <p className="text-sm text-ink-dim">Saved records remain on this device. Unsaved changes may need to be entered again.</p>
        <button onClick={() => this.setState({ message: "" })} className="border border-edge px-3 py-2 text-sm">
          Try again
        </button>
      </div>
    );
  }
}

function FocusSummary({ focus }: { focus: FocusState }) {
  const now = useClock(!focus.paused_at, 1000);
  return <NavLink to="/focus" className="panel block p-3 text-center" aria-label="Open running focus timer">
    <div className="text-xs uppercase tracking-widest text-accent">{focus.paused_at ? "paused" : "deep mode"}</div>
    <div className="font-digits text-4xl leading-none">{Math.ceil(focusRemainingSec(focus, now) / 60)} min</div>
    {focus.intent && <div className="truncate text-xs text-ink-dim">{focus.intent}</div>}
  </NavLink>;
}

export default function App() {
  const nav = useNavigate();
  const location = useLocation();
  // All views share one scroll container. Without this, opening Planner or Projects after
  // scrolling a long list kept the old offset and showed the bottom of the new view.
  const mainRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => { mainRef.current?.scrollTo(0, 0); }, [location.pathname]);
  const [navOpen, setNavOpen] = useState(false);
  const [error, setError] = useState("");
  const { state: focus, error: focusError } = useFocus();
  const [modal, setModal] = useState<ModalRequest | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const openCapture = useCallback(() => { setNavOpen(false); setCaptureOpen(true); }, []);
  useCompanionBridge(setError);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "k" && !document.querySelector('[role="dialog"]')) {
        event.preventDefault(); openCapture();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [openCapture]);

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
        body: "Exiting stops the timer, site/app blocking, and phone sharing. The session is logged as broken. Type the honest reason.",
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
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("mizan://close-requested", () => askExit()).then((u) => (dead ? u() : (un = u))),
    ).catch((e: unknown) => setError(`Cannot handle window close requests: ${String(e)}`));
    return () => {
      dead = true;
      un?.();
    };
  }, [askExit]);

  let k = 0;

  return (
    <div className={`app-shell ${navOpen ? "nav-open" : ""} ${location.pathname.startsWith("/team") ? "space-team" : ""}`}>
      <header className="compact-header">
        <button onClick={() => setNavOpen(!navOpen)} aria-expanded={navOpen} aria-controls="app-navigation" aria-label="Toggle navigation">
          <Menu className="px-icon h-5 w-5" />
        </button>
        <span className="font-pixel text-xs">MIZAN</span>
        <span className="text-sm text-ink-dim">{FLAT.find((n) => n.to === location.pathname)?.label ?? (location.pathname.startsWith("/team") ? "team" : "")}</span>
        <button onClick={openCapture} className="ml-auto border border-edge px-3 text-xs" title="Ctrl+Shift+K">Capture</button>
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

        <button onClick={openCapture} className="mx-3 my-2 border border-edge px-3 py-2 text-left text-sm" title="Ctrl+Shift+K">Quick capture</button>
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
                {g.label === "team" && <TeamNav close={() => setNavOpen(false)} />}
              </div>
            </div>
          ))}
        </nav>
        <p className="mt-3 px-6 text-[10px] text-ink-dim">
          ctrl+k <span className="text-ink-faint">→</span> command palette
        </p>

        <div className="mt-auto space-y-4 p-4">
          {focus && !focus.broken_at && <FocusSummary focus={focus} />}
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

      <main id="main-content" ref={mainRef} className="app-content" inert={navOpen}>
        {notice && <div className="mb-4 flex items-center justify-between gap-3 border border-edge p-3 text-sm">
          <span role="status">{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss capture confirmation">Dismiss</button>
        </div>}
        {error && <div role="alert" className="mb-4 flex items-center justify-between gap-3 border border-danger p-3 text-sm text-danger">
          {error}<button onClick={() => setError("")} aria-label="Dismiss error">Dismiss</button>
        </div>}
        {focusError && <p role="alert" className="mb-4 text-sm text-danger">{focusError}</p>}
        <ViewErrorBoundary key={location.pathname}>
          <Suspense fallback={<p role="status">Loading view...</p>}><Outlet /></Suspense>
        </ViewErrorBoundary>
      </main>
      <Palette extra={[{ label: "Quick capture", hint: "task or log · Ctrl+Shift+K", run: openCapture }, { label: "Exit Mizan", hint: "quit completely", run: askExit }]} />
      <QuickCapture open={captureOpen} close={() => setCaptureOpen(false)} saved={setNotice} />
      <Modal req={modal} close={() => setModal(null)} />
    </div>
  );
}
