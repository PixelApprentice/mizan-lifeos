// Muezza — the pixel-cat mascot. Hand-drawn sprite frames, no animation tooling.
// Mood follows app state: idle (blinks), focus (deep mode), celebrate (9/9 day), warn (broken).
import { useEffect, useState } from "react";
import { PixelArt } from "./Pixel";

export type Mood = "idle" | "focus" | "celebrate" | "warn";

// 12×10 pixel cat. c = fur (mood colour), E = eyes, n = nose, . = transparent.
const EARS = ["c..........c", "cc........cc", "ccc......ccc", "cccccccccccc"];
const BODY = ["cccccnnccccc", "cccccccccccc", ".cccccccccc.", "..cccccccc.."];
const FRAMES: Record<Mood, string[][]> = {
  idle: [
    [...EARS, "ccEEccccEEcc", "ccEEccccEEcc", ...BODY],
    [...EARS, "cccccccccccc", "ccEEccccEEcc", ...BODY],
  ],
  focus: [
    [...EARS, "ccEccccccEcc", "cccEccccEccc", ...BODY],
    [...EARS, "ccEEEccEEEcc", "cccccccccccc", ...BODY],
  ],
  celebrate: [
    [...EARS, "cccEccccEccc", "ccEcEccEcEcc", ...BODY],
    [...EARS.map((r, i) => (i === 0 ? "c....y.....c" : r)), "cccEccccEccc", "ccEcEccEcEcc", ...BODY],
  ],
  warn: [
    [...EARS, "cccccccccccc", "ccEEccccEEcc", "ccccnnnncccc", "cccccccccccc", ".cccccccccc.", "..cccccccc.."],
    [...EARS, "cccccccccccc", "cEEccccccEEc", "ccccnnnncccc", "cccccccccccc", ".cccccccccc.", "..cccccccc.."],
  ],
};
const FUR: Record<Mood, string> = { idle: "#34d399", focus: "#34d399", celebrate: "#eab308", warn: "#f87171" };

const QUIPS: Record<Mood, string[]> = {
  idle: ["file the log.", "small + daily > heroic.", "what shipped today?", "the tracker is watching."],
  focus: ["locked in.", "phone is far away, right?", "one task. nothing else."],
  celebrate: ["9/9. again tomorrow.", "streak protected!", "alhamdulillah. log it."],
  warn: ["broken session logged.", "friday review will ask.", "one hadith, then back."],
};

export default function Mascot({ mood, streak }: { mood: Mood; streak?: number }) {
  const [frame, setFrame] = useState(0);
  const [quip, setQuip] = useState(0);

  useEffect(() => {
    // Blink cadence differs per mood so it feels alive, not metronomic.
    const speed = mood === "celebrate" ? 350 : mood === "focus" ? 900 : 2400;
    const id = setInterval(() => setFrame((f) => f + 1), speed);
    const q = setInterval(() => setQuip((v) => v + 1), 12000);
    return () => {
      clearInterval(id);
      clearInterval(q);
    };
  }, [mood]);

  const frames = FRAMES[mood];
  const quips = QUIPS[mood];

  return (
    <div className={`select-none text-center ${mood === "celebrate" ? "animate-bounce" : ""}`}>
      <PixelArt
        rows={frames[frame % frames.length]}
        palette={{ c: FUR[mood], E: "#000", n: "#f9a8d4", y: "#eab308" }}
        size={4}
        className="mx-auto drop-shadow-[0_0_8px_rgba(52,211,153,0.25)]"
        title={`Muezza (${mood})`}
      />
      <div className="mt-1 text-[10px] text-ink-dim">
        {streak !== undefined && streak > 1 ? `▲ ${streak}-day streak · ` : ""}
        {quips[quip % quips.length]}
      </div>
    </div>
  );
}
