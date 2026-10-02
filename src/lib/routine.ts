// The daily routine on Today: which habits you check in, their targets and how the day is
// scored. Stored as a setting so anyone can shape it; the original faith-and-study routine
// is kept as a preset with its own scoring rules (scripts/score.py).
import type { TrackerRow } from "./api";
import { scoreRow } from "./score.ts";

export type RoutineType = "bool" | "min" | "count" | "number";
export interface RoutineItem {
  key: string;
  label: string;
  type: RoutineType;
  /** Daily target for min/count items; weekend falls back to weekday. */
  weekday?: number | null;
  weekend?: number | null;
  /** Counts toward the daily score (needs a target unless it is a checkbox). */
  scored: boolean;
  /** Only show on these weekdays (0 = Sunday). */
  days?: number[];
}
export interface Routine {
  preset: "general" | "faith" | "custom";
  /** "classic" keeps the original 9-point rules; "items" scores each scored item. */
  scoring: "classic" | "items";
  showPrayers: boolean;
  items: RoutineItem[];
}

export const GENERAL: Routine = {
  preset: "general",
  scoring: "items",
  showPrayers: false,
  items: [
    { key: "sleep_on_time", label: "Slept on time", type: "bool", scored: true },
    { key: "movement", label: "Exercise or a walk", type: "bool", scored: true },
    { key: "build_min", label: "Deep work minutes", type: "min", weekday: 90, weekend: 60, scored: true },
    { key: "reading_min", label: "Reading minutes", type: "min", weekday: 20, scored: true },
    { key: "consume_min", label: "Passive screen minutes", type: "min", scored: false },
    { key: "family_call", label: "Connected with family or a friend", type: "bool", scored: true },
    { key: "no_junk_spend", label: "No impulse spending", type: "bool", scored: true },
    { key: "urges_redirected", label: "Distractions resisted", type: "count", scored: false },
  ],
};

export const FAITH: Routine = {
  preset: "faith",
  scoring: "classic",
  showPrayers: true,
  items: [
    { key: "fajr_on_time", label: "Fajr on time (before sunrise)", type: "bool", scored: true },
    { key: "prayers_5", label: "All five prayers on time", type: "bool", scored: true },
    { key: "sleep_on_time", label: "Sleep routine followed", type: "bool", scored: true },
    { key: "quran_min", label: "Quran minutes", type: "min", weekday: 60, scored: true },
    { key: "dsa_min", label: "DSA minutes", type: "min", weekday: 45, weekend: 60, scored: true },
    { key: "dsa_problems", label: "DSA problems solved", type: "count", scored: false },
    { key: "build_min", label: "Build minutes", type: "min", weekday: 90, weekend: 300, scored: true },
    { key: "consume_min", label: "Consume minutes (≤ ⅓ of build)", type: "min", scored: true },
    { key: "islamic_knowledge_min", label: "Islamic knowledge minutes", type: "min", weekday: 20, weekend: 30, scored: true },
    { key: "movement", label: "Movement", type: "bool", scored: true },
    { key: "family_call", label: "Family check-in", type: "bool", scored: true },
    { key: "video", label: "Teaching video uploaded (one take)", type: "bool", scored: false },
    { key: "no_junk_spend", label: "Zero junk spending", type: "bool", scored: true },
    { key: "spend_birr", label: "Spending today (local currency)", type: "count", scored: false },
    { key: "urges_redirected", label: "Distractions redirected", type: "count", scored: false },
    { key: "weight_kg", label: "Friday weigh-in (kg)", type: "number", scored: false, days: [5] },
  ],
};

export const PRESETS = { general: GENERAL, faith: FAITH } as const;
export const SETTING_KEY = "routine";

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED = new Set(["date", "day", "score", "notes", "log_filed", "exam_mode", "shipped"]);

/** Column key for a new custom item: "Drink water" → "drink_water". */
export function keyFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  if (!/^[a-z]/.test(base)) base = `habit_${base}`.replace(/_+$/, "");
  if (RESERVED.has(base)) base = `my_${base}`;
  let key = base || "habit";
  for (let i = 2; used.has(key); i++) key = `${base}_${i}`;
  return key;
}

/** Parse a stored routine, falling back to `fallback` for anything malformed. */
export function parseRoutine(text: string | null | undefined, fallback: Routine): Routine {
  if (!text) return fallback;
  try {
    const raw = JSON.parse(text) as Partial<Routine>;
    const items = Array.isArray(raw.items) ? raw.items.filter((i): i is RoutineItem =>
      !!i && typeof i.key === "string" && KEY_RE.test(i.key) && !RESERVED.has(i.key) && typeof i.label === "string" && ["bool", "min", "count", "number"].includes(i.type)) : [];
    if (!items.length) return fallback;
    return {
      preset: raw.preset === "faith" || raw.preset === "general" ? raw.preset : "custom",
      scoring: raw.scoring === "classic" ? "classic" : "items",
      showPrayers: raw.showPrayers === true,
      items: items.map((i) => ({ ...i, label: i.label.slice(0, 80), scored: i.scored !== false })),
    };
  } catch {
    return fallback;
  }
}

/** Starting routine: the original one for people who already track it, neutral otherwise. */
export function defaultRoutine(rows: readonly TrackerRow[]): Routine {
  const faithful = rows.some((r) => ["fajr_on_time", "quran_min", "islamic_knowledge_min", "dsa_min"].some((k) => r[k] && r[k] !== "0"));
  return faithful ? FAITH : GENERAL;
}

const isWeekend = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
};
export const targetOf = (item: RoutineItem, weekend: boolean) => (weekend ? item.weekend ?? item.weekday : item.weekday) ?? null;
export const visibleOn = (item: RoutineItem, date: string) => {
  if (!item.days?.length) return true;
  const [y, m, d] = date.split("-").map(Number);
  return item.days.includes(new Date(y, m - 1, d).getDay());
};

/** Items that count toward the score, for the "x / max" display. */
export function scoredItems(r: Routine): RoutineItem[] {
  return r.items.filter((i) => i.scored && i.type !== "number" && (i.type === "bool" || targetOf(i, false) !== null));
}

export function maxScore(r: Routine): number {
  return r.scoring === "classic" ? 9 : scoredItems(r).length;
}

/** Score for a day's check-in, plus the names of what was missed. */
export function scoreDay(r: Routine, row: TrackerRow): { score: number; max: number; failed: string[] } {
  if (r.scoring === "classic") return { ...scoreRow(row), max: 9 };
  const weekend = isWeekend(row.date);
  const failed: string[] = [];
  const items = scoredItems(r).filter((i) => visibleOn(i, row.date));
  for (const item of items) {
    const v = Number(row[item.key] ?? 0) || 0;
    const ok = item.type === "bool" ? v === 1 : v >= (targetOf(item, weekend) ?? 0);
    if (!ok) failed.push(item.label.toLowerCase());
  }
  return { score: items.length - failed.length, max: items.length, failed };
}
