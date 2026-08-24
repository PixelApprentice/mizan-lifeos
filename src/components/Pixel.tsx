// Pixel-art primitives: grid sprites rendered as crisp SVG rects, segmented bars, hearts.
// Sprites are plain strings — one char per pixel, "." is transparent.
import type { CSSProperties } from "react";

type Palette = Record<string, string>;

export function PixelArt({
  rows,
  palette,
  size = 3,
  className,
  style,
  title,
}: {
  rows: string[];
  palette: Palette;
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const rects = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const c = palette[rows[y][x]];
      if (c) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={c} />);
    }
  }
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w * size}
      height={h * size}
      shapeRendering="crispEdges"
      className={className}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {rects}
    </svg>
  );
}

// ميزان — the balance. Also the app icon (see public/mizan-icon.svg).
export const SCALE = [
  "......yyyy......",
  "......yyyy......",
  ".......GG.......",
  ".gggggggggggggg.",
  "..G....GG....G..",
  ".G.G...GG...G.G.",
  ".G.G...GG...G.G.",
  "G...G..GG..G...G",
  "yyyyy..GG..yyyyy",
  ".yyy...GG...yyy.",
  ".......GG.......",
  ".......GG.......",
  ".......GG.......",
  ".....gggggg.....",
  "....gggggggg....",
];
export const SCALE_PALETTE: Palette = { g: "#34d399", G: "#10b981", y: "#eab308" };

export function Logo({ size = 3 }: { size?: number }) {
  return <PixelArt rows={SCALE} palette={SCALE_PALETTE} size={size} title="Mizan" />;
}

/** Segmented progress bar, like an old-school HP/XP meter. */
export function PixelBar({
  value,
  max,
  segments = 20,
  color = "var(--color-accent)",
  className = "",
}: {
  value: number;
  max: number;
  segments?: number;
  color?: string;
  className?: string;
}) {
  const filled = max > 0 ? Math.round((Math.min(value, max) / max) * segments) : 0;
  return (
    <div className={`flex gap-[2px] ${className}`} role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className="h-2.5 flex-1"
          style={{ background: i < filled ? color : "var(--color-edge)", boxShadow: i < filled ? `0 0 6px ${color}55` : "none" }}
        />
      ))}
    </div>
  );
}

const HEART = [".rr.rr.", "rrrrrrr", "rrrrrrr", ".rrrrr.", "..rrr..", "...r..."];

/** "n of total" pixel hearts — the day's non-negotiables as a life bar. */
export function Hearts({ n, total = 9 }: { n: number; total?: number }) {
  return (
    <div className="flex flex-wrap justify-center gap-[3px]" title={`${n}/${total} non-negotiables`}>
      {Array.from({ length: total }, (_, i) => (
        <PixelArt key={i} rows={HEART} palette={{ r: i < n ? "#f87171" : "#26262c" }} size={2} />
      ))}
    </div>
  );
}
