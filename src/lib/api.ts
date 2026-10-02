// Typed wrappers around Tauri invoke + SQLite access.
// Demo mode: when running outside Tauri (plain browser), every call is served from
// in-memory fakes so the UI stays fully navigable — useful for UI work and screenshots.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { focusRemainingSec, sessionRecord } from "./focusTime";
export { focusRemainingSec } from "./focusTime";

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface Prayers {
  fajr: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
}

export interface DayInfo {
  date: string;
  /** Day 1 of the system (YYYY-MM-DD) and its weekday (0 = Sunday). */
  day1: string;
  day1_weekday: number;
  dow: string;
  day: number;
  week: number;
  fasting: boolean;
  prayers: Prayers;
}

export interface LifeosConfig {
  start_date: string;
}

export interface FocusState {
  started_at: string;
  ends_at: string;
  planned_min: number;
  sites: string[];
  apps: string[];
  kills: number;
  intent: string | null;
  disc: string | null;
  paused_at: string | null;
  broken_at: string | null;
  broken_reason: string | null;
  /** Times the paired phone left the focus display during this session. */
  phone_leaves?: number;
}

export interface SessionRecord {
  started_at: string;
  ended_at: string;
  planned_min: number;
  actual_min: number;
  broken: boolean;
  reason: string;
  kills: number;
  phone_leaves?: number;
}

export type TrackerRow = Record<string, string>;

export interface Task {
  id: number;
  title: string;
  notes: string;
  kind: string;
  status: string;
  parent_id: number | null;
  est_min: number;
  due: string | null;
  created_at: string;
  project_id: number | null;
  /** 1 = high, 2 = normal, 3 = low */
  priority: number;
  position?: number;
  completed_at?: string | null;
  sync_id?: string | null;
  updated_at?: string | null;
}

export interface Project {
  id: number;
  name: string;
  goal: string;
  color: string;
  due: string | null;
  status: string;
  created_at: string;
}

export interface CompanionStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  addresses: string[];
  pair_url: string | null;
  qr_svg: string | null;
  error: string | null;
}

export interface CalEvent {
  id: number;
  title: string;
  start: string;
  end: string;
  task_id: number | null;
  color: string;
  done: number;
}

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function fmt12h(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}

// ---------------- demo fakes (browser / screenshots) ----------------

const demoTask = (id: number, title: string, kind: string, status: string, est_min: number, project_id: number | null, priority = 2): Task => ({
  id, title, notes: "", kind, status, parent_id: null, est_min, due: null, created_at: `${todayStr()} 09:00:00`, project_id, priority,
});

export const demo = {
  focus: null as FocusState | null,
  sessions: [] as SessionRecord[],
  projects: [
    { id: 1, name: "Example project", goal: "Finish a small useful improvement", color: "#34d399", due: null, status: "active", created_at: "" },
    { id: 2, name: "Learning", goal: "Practice a new skill", color: "#eab308", due: null, status: "active", created_at: "" },
  ] as Project[],
  tasks: [
    demoTask(1, "Define the next milestone", "other", "doing", 25, 1, 1),
    demoTask(2, "Build a first draft", "code", "open", 50, 1),
    demoTask(3, "Review and test", "code", "open", 30, 1),
    demoTask(4, "Read one chapter", "study", "open", 30, 2),
    demoTask(5, "Choose a practice exercise", "study", "done", 20, 2),
    demoTask(6, "Review this week's notes", "study", "backlog", 20, 2, 3),
  ] as Task[],
  events: [] as CalEvent[],
  settings: new Map<string, string>([
    ["disc_path", ""],
    ["blocked_sites", ""],
    ["blocked_apps", ""],
    ["focus_presets", "25,50,90"],
  ]),
  nextId: 10,
  companion: false,
  logs: new Map<string, string>(),
  configs: new Map<string, LifeosConfig>(),
  trackers: new Map<string, TrackerRow[]>(),
};

function demoDate(value: unknown): Date {
  const text = String(value ?? todayStr());
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error("date must be a real calendar date in YYYY-MM-DD format");
  }
  return parsed;
}

function demoConfig(root: string): LifeosConfig {
  if (!demo.configs.has(root)) demo.configs.set(root, { start_date: todayStr() });
  return demo.configs.get(root)!;
}

function demoDayInfo(date: unknown, root: string): DayInfo {
  const requested = demoDate(date);
  const config = demoConfig(root);
  const start = demoDate(config.start_date);
  const day = Math.round((requested.getTime() - start.getTime()) / 86400000) + 1;
  return {
    date: requested.toISOString().slice(0, 10),
    day1: config.start_date,
    day1_weekday: start.getUTCDay(),
    dow: requested.toLocaleDateString("en", { weekday: "long", timeZone: "UTC" }),
    day,
    week: Math.floor((Math.max(1, day) - 1) / 7) + 1,
    fasting: [1, 4].includes(requested.getUTCDay()),
    prayers: { fajr: "check", dhuhr: "check", asr: "check", maghrib: "check", isha: "check" },
  };
}

function demoInvoke(cmd: string, args: Record<string, unknown>): unknown {
  const root = String(args.disc ?? "");
  switch (cmd) {
    case "get_lifeos_config":
      return { ...demoConfig(root) };
    case "set_lifeos_start": {
      const config = { start_date: demoDate(args.startDate).toISOString().slice(0, 10) };
      demo.configs.set(root, config);
      return { ...config };
    }
    case "day_info":
      return demoDayInfo(args.date, root);
    case "read_tracker":
      return (demo.trackers.get(root) ?? []).map((row) => ({ ...row }));
    case "read_sessions":
    case "focus_status":
      if (demo.focus && !demo.focus.paused_at) {
        if (demo.focus.broken_at) {
          if (Date.now() - Date.parse(demo.focus.broken_at) >= 300000) demo.focus = null;
        } else if (focusRemainingSec(demo.focus, Date.now()) === 0) {
          demo.sessions.push(sessionRecord(demo.focus, Date.parse(demo.focus.ends_at), false));
          demo.focus = null;
        }
      }
      if (cmd === "read_sessions") return [...demo.sessions];
      return demo.focus;
    case "focus_start": {
      const min = args.minutes as number;
      demoInvoke("focus_status", {});
      if (demo.focus) throw new Error("A focus session is already running or cooling down.");
      if (!Number.isInteger(min) || min < 5 || min > 480) throw new Error("Choose 5 to 480 whole minutes.");
      demo.focus = {
        started_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + min * 60000).toISOString(),
        planned_min: min,
        sites: (args.sites as string[]) ?? [],
        apps: (args.apps as string[]) ?? [],
        kills: 0,
        intent: (args.intent as string) ?? null,
        disc: null,
        paused_at: null,
        broken_at: null,
        broken_reason: null,
      };
      return demo.focus;
    }
    case "focus_end": {
      if (!demo.focus || demo.focus.broken_at) throw new Error("No running session to end.");
      const broken = focusRemainingSec(demo.focus, Date.now()) > 0;
      const reason = String(args.reason ?? "").trim();
      if (broken && reason.length < 5) throw new Error("Give a reason of at least 5 characters.");
      demo.sessions.push(sessionRecord(demo.focus, Date.now(), broken, reason));
      if (broken) demo.focus = { ...demo.focus, broken_at: new Date().toISOString(), broken_reason: reason };
      else demo.focus = null;
      return null;
    }
    case "focus_pause":
      demoInvoke("focus_status", {});
      if (!demo.focus || demo.focus.broken_at) throw new Error("No running session to pause.");
      if (demo.focus) {
        demo.focus = { ...demo.focus };
        if (demo.focus.paused_at) {
          const delta = Date.now() - new Date(demo.focus.paused_at).getTime();
          demo.focus.ends_at = new Date(new Date(demo.focus.ends_at).getTime() + delta).toISOString();
          demo.focus.paused_at = null;
        } else {
          demo.focus.paused_at = new Date().toISOString();
        }
      }
      return demo.focus;
    case "perm_block_apply":
      return ((args.extra as string[]) ?? []).length + 41337;
    case "perm_block_clear":
    case "app_quit":
      return null;
    case "companion_status":
    case "companion_set_enabled":
    case "companion_reset_token":
      if (cmd === "companion_set_enabled") demo.companion = Boolean(args.enabled);
      return { enabled: demo.companion, running: false, port: 47615, addresses: [], pair_url: null, qr_svg: null, error: demo.companion ? "The browser preview cannot open a network server. Run the desktop app." : null };
    case "companion_usb_connect":
      throw new Error("The browser preview cannot reach a phone over USB. Run the desktop app.");
    case "upsert_tracker_row": {
      const date = demoDate(args.date).toISOString().slice(0, 10);
      const rows = demo.trackers.get(root) ?? [];
      const index = rows.findIndex((row) => row.date === date);
      const row = { ...(index < 0 ? {} : rows[index]), ...(args.fields as TrackerRow), date };
      if (index < 0) rows.push(row);
      else rows[index] = row;
      demo.trackers.set(root, rows);
      return null;
    }
    case "append_to_log":
    case "write_day_log":
    case "ensure_day_log":
    case "read_day_log": {
      const day = demoDayInfo(args.date, root);
      const key = JSON.stringify([root, day.date]);
      if (cmd === "ensure_day_log") {
        if (!demo.logs.has(key)) {
          demo.logs.set(key, `# Day ${day.day} — ${day.dow}, ${day.date} · Week ${day.week}\n\n## Plan\n\nMain priority:\n\n1.\n2.\n3.\n\n## Notes\n\n\n## Review\n\nCompleted:\nWhat worked:\nWhat to change:\nNext step:\n`);
        }
        return `demo/log/${day.date}.md`;
      }
      if (!demo.logs.has(key)) throw new Error("no log for that day yet — create it first");
      if (cmd === "read_day_log") return demo.logs.get(key)!;
      if (cmd === "write_day_log") {
        if (args.expected != null && args.expected !== demo.logs.get(key)) throw new Error("The log changed while saving. Retry Save.");
        demo.logs.set(key, String(args.content ?? ""));
      }
      else demo.logs.set(key, demo.logs.get(key)! + "\n" + String(args.text ?? "") + "\n");
      return null;
    }
    default:
      return null;
  }
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!IS_TAURI) return demoInvoke(cmd, args) as T;
  return tauriInvoke<T>(cmd, args);
}

// ---------------- SQLite (real) / fake (demo) ----------------

interface DbLike {
  select<T>(q: string, params?: unknown[]): Promise<T>;
  execute(q: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
}

// Demo mode only needs settings here; tasks/projects/events go through lib/data.ts.
const fakeDb: DbLike = {
  async select<T>(q: string, params: unknown[] = []): Promise<T> {
    if (q.includes("key LIKE")) {
      const prefix = String(params[0]).slice(0, -1);
      return [...demo.settings].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })) as T;
    }
    if (q.includes("FROM settings")) {
      const v = demo.settings.get(String(params[0]));
      return (v !== undefined ? [{ value: v }] : []) as T;
    }
    return [] as T;
  },
  async execute(q: string, params: unknown[] = []): Promise<{ rowsAffected: number }> {
    if (q.startsWith("DELETE FROM settings")) demo.settings.delete(String(params[0]));
    if (q.startsWith("INSERT INTO settings")) {
      demo.settings.set(String(params[0]), String(params[1]));
    }
    return { rowsAffected: 1 };
  },
};

let dbPromise: Promise<DbLike> | null = null;
export function db(): Promise<DbLike> {
  if (!IS_TAURI) return Promise.resolve(fakeDb);
  dbPromise ??= Database.load("sqlite:mizan.db").catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

export async function getSetting(key: string): Promise<string> {
  const d = await db();
  const rows = await d.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? "";
}

export async function setSetting(key: string, value: string): Promise<void> {
  const d = await db();
  await d.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [key, value],
  );
  window.dispatchEvent(new Event("mizan:settings-changed"));
}

export async function listSettings(prefix: string): Promise<{ key: string; value: string }[]> {
  if (!/^[a-z]+:$/.test(prefix)) throw new Error("Invalid settings namespace.");
  return (await db()).select<{ key: string; value: string }[]>("SELECT key, value FROM settings WHERE key LIKE $1 ORDER BY key", [`${prefix}%`]);
}

export async function deleteSetting(key: string): Promise<void> {
  await (await db()).execute("DELETE FROM settings WHERE key=$1", [key]);
}

// Every disc-touching command passes the configured path so Settings actually governs it.
async function discArg(): Promise<string | null> {
  const p = await getSetting("disc_path");
  return p || null;
}

// ---------------- public API ----------------

export const dayInfo = async (date?: string) =>
  call<DayInfo>("day_info", { date: date ?? null, disc: await discArg() });
export const getLifeosConfig = async () =>
  call<LifeosConfig>("get_lifeos_config", { disc: await discArg() });
export const setLifeosStart = async (startDate: string) =>
  call<LifeosConfig>("set_lifeos_start", { startDate, disc: await discArg() });
export const readTracker = async () => call<TrackerRow[]>("read_tracker", { disc: await discArg() });
export const upsertTrackerRow = async (date: string, fields: Record<string, string>) =>
  call<void>("upsert_tracker_row", { date, fields, disc: await discArg() });
export const ensureDayLog = async (date?: string) =>
  call<string>("ensure_day_log", { date: date ?? null, disc: await discArg() });
export const readDayLog = async (date: string) => call<string>("read_day_log", { date, disc: await discArg() });
export const writeDayLog = async (date: string, content: string, expected?: string) =>
  call<void>("write_day_log", { date, content, expected: expected ?? null, disc: await discArg() });
export const appendToLog = async (date: string, text: string) =>
  call<void>("append_to_log", { date, text, disc: await discArg() });
async function focusAction<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await call<T>(command, args);
  window.dispatchEvent(new Event("mizan:focus-changed"));
  return result;
}
export const focusStart = async (minutes: number, sites: string[], apps: string[], intent: string) =>
  focusAction<FocusState>("focus_start", {
    minutes,
    sites,
    apps,
    intent: intent || null,
    disc: await discArg(),
  });
export const focusEnd = (reason?: string) => focusAction<void>("focus_end", { reason: reason ?? null });
export const focusStatus = () => call<FocusState | null>("focus_status");
export const focusPause = () => focusAction<FocusState>("focus_pause");
export const readSessions = () => call<SessionRecord[]>("read_sessions");
export const permBlockApply = (extra: string[], importUrl: string | null) =>
  call<number>("perm_block_apply", { extra, importUrl });
export const permBlockClear = () => call<void>("perm_block_clear");
/** Quit completely: ends any session (logged), lifts blocks, closes every window. */
export const appQuit = (reason?: string) => call<void>("app_quit", { reason: reason ?? null });
export const companionStatus = () => call<CompanionStatus>("companion_status");
export const companionSetEnabled = (enabled: boolean, port?: number) =>
  call<CompanionStatus>("companion_set_enabled", { enabled, port: port ?? null });
export const companionResetToken = () => call<CompanionStatus>("companion_reset_token");
export const companionUsbConnect = () => call<string>("companion_usb_connect");
