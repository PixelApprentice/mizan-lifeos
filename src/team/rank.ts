// Fractional ranks: strings that sort in board/backlog order. Moving a card writes one new
// rank between its neighbours, so concurrent moves by teammates never renumber a column.
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
const digit = (c: string) => {
  const n = DIGITS.indexOf(c);
  if (n < 0) throw new Error(`Invalid rank character "${c}".`);
  return n;
};

/** A rank strictly between `a` and `b` (either may be null for the start or end). */
export function rankBetween(a: string | null, b: string | null): string {
  const lo = a ?? "";
  if (b !== null && lo >= b) throw new Error(`Rank bounds out of order: "${lo}" ≥ "${b}".`);
  let out = "";
  let bounded = b !== null;
  for (let i = 0; ; i++) {
    const da = i < lo.length ? digit(lo[i]) : 0;
    const db = bounded && b !== null && i < b.length ? digit(b[i]) : BASE;
    if (db - da > 1) return out + DIGITS[Math.floor((da + db) / 2)];
    out += DIGITS[da];
    if (db - da === 1) bounded = false;
    if (i > 200) throw new Error("Rank grew too long.");
  }
}

/** `n` evenly spread ranks for seeding a list. */
export function initialRanks(n: number): string[] {
  const out: string[] = [];
  const width = Math.max(1, Math.ceil(Math.log(n + 2) / Math.log(BASE)));
  const step = Math.floor(BASE ** width / (n + 1));
  for (let i = 1; i <= n; i++) {
    let v = i * step;
    let s = "";
    for (let k = 0; k < width; k++) { s = DIGITS[v % BASE] + s; v = Math.floor(v / BASE); }
    out.push(s.replace(/0+$/, "") || "1");
  }
  return out;
}

export const byRank = <T extends { rank?: string | null; created_at?: string | null }>(x: T, y: T) =>
  (x.rank ?? "").localeCompare(y.rank ?? "") || (x.created_at ?? "").localeCompare(y.created_at ?? "");

/** Rank for dropping an item before/after `targetIndex` in an ordered list (without the moving item). */
export function rankForDrop(list: readonly { rank?: string | null }[], targetIndex: number, placement: "before" | "after"): string {
  const ranks = list.map((x) => x.rank || null);
  const at = placement === "before" ? targetIndex : targetIndex + 1;
  const prev = at > 0 ? ranks[at - 1] : null;
  const next = at < ranks.length ? ranks[at] : null;
  if (prev && next && prev >= next) return rankBetween(prev, null);
  return rankBetween(prev, next);
}
