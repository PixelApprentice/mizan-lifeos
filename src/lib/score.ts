// Port of disc/scripts/score.py → score_row(), so the app writes the same 0–9 score the
// script would. Keep the two in sync if the minimums change.
import type { TrackerRow } from "./api";

export function currentStreak(rows: TrackerRow[], predicate: (row: TrackerRow) => boolean, today: string): number {
  const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;
  const end = dayNumber(today);
  const days = new Map(rows.filter((row) => dayNumber(row.date) <= end).map((row) => [dayNumber(row.date), row]));
  let cursor = days.has(end) ? end : end - 1;
  let count = 0;
  while (days.has(cursor)) {
    const row = days.get(cursor)!;
    if (!predicate(row)) break;
    count++;
    cursor--;
  }
  return count;
}

const n = (v: string | undefined) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
};

export function scoreRow(row: TrackerRow): { score: number; failed: string[] } {
  const [y, m, d] = row.date.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const w = dow === 0 || dow === 6;
  const exam = n(row.exam_mode) === 1;
  const failed: string[] = [];
  if (!(n(row.fajr_on_time) && n(row.prayers_5))) failed.push("prayers");
  if (!n(row.sleep_on_time)) failed.push("sleep");
  if (n(row.quran_min) < 60) failed.push("quran");
  if (n(row.dsa_min) < (w ? 60 : 45)) failed.push("dsa");
  const build = n(row.build_min);
  const consume = n(row.consume_min);
  const ratio = build ? consume / build : consume ? Infinity : 0;
  const buildReq = exam && !w ? 0 : w ? 300 : 90;
  if (build < buildReq) failed.push("build");
  else if (ratio > 1 / 3) failed.push("tutorial hell");
  if (n(row.islamic_knowledge_min) < (w ? 30 : 20)) failed.push("knowledge");
  if (!n(row.movement)) failed.push("movement");
  if (!n(row.family_call)) failed.push("family call");
  if (!(n(row.log_filed) && n(row.no_junk_spend))) failed.push("log/money");
  return { score: 9 - failed.length, failed };
}
