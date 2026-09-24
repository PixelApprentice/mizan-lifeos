// Mizan intro trailer, for people who have never seen the app.
// `pnpm demo:footage` once, then `pnpm demo:trailer` (add `--stills auto` for a quick preview).
//
// Story: the problem (too many apps) → the answer (Mizan) → a fast tour → the day, feature by
// feature, told as benefits → the phone → the promise (private) → the name to remember.
// Scene lengths are in beats so cuts land on the music; footage times come from the marks
// that the recorder writes next to the clips.

import { existsSync, readFileSync } from "node:fs";

if (!existsSync("recordings/footage/marks.json")) throw new Error("No footage yet. Run `pnpm demo:footage` first.");
const marks = JSON.parse(readFileSync("recordings/footage/marks.json", "utf8"));
const d = marks.desktop, p = marks.phone, r = marks.phoneRect;
const inset = 18; // phone stage border + bezel, in recorded pixels

export default {
  brand: "MIZAN",
  out: "recordings/mizan-trailer.mp4",
  bpm: 120,
  fps: 30,
  icon: "public/mizan-icon.svg",
  theme: { accent: "#6ee7b7", accent2: "#eab308" },
  footage: {
    desktop: { file: "recordings/footage/desktop.mp4" },
    phone: { file: "recordings/footage/phone.mp4", crop: [r.w - inset * 2, r.h - inset * 2, r.x + inset, r.y + inset] },
  },
  scenes: [
    {
      type: "collapse", beats: 14, kicker: "Your day, right now",
      items: ["To-do list", "Calendar", "Pomodoro timer", "Notes app", "Habit tracker", "Kanban board", "Site blocker", "Journal"],
      answerKicker: "What if", title: "it all lived in one calm place?",
    },
    { type: "logo", beats: 8, transition: "flash", title: "MIZAN", tagline: "mīzān · Arabic for balance" },
    { type: "words", beats: 8, transition: "zoom", kicker: "One app to", words: ["Plan.", "Focus.", "Reflect.", "Balance."] },
    {
      type: "montage", transition: "pixels", kicker: "Everything in one place",
      clips: [
        { source: "desktop", from: d.today + 2, speed: 1, beats: 2, label: "Today", windowTitle: "Mizan — Today", x: 0.6, y: 0.25 },
        { source: "desktop", from: d.planner + 0.8, speed: 1, beats: 2, label: "This week", windowTitle: "Mizan — Planner", x: 0.6, y: 0.5 },
        { source: "desktop", from: d.kanban + 4, speed: 1.6, beats: 2, label: "Projects", windowTitle: "Mizan — Projects", x: 0.55, y: 0.55 },
        { source: "desktop", from: d.timer + 0.5, speed: 1, beats: 2, label: "Deep work", windowTitle: "Mizan — Focus", x: 0.55, y: 0.35 },
        { source: "desktop", from: d.log + 3, speed: 1.4, beats: 2, label: "Journal", windowTitle: "Mizan — Log", x: 0.4, y: 0.35 },
        { source: "desktop", from: d.stats + 3, speed: 1.2, beats: 2, label: "Progress", windowTitle: "Mizan — Stats", x: 0.6, y: 0.4 },
      ],
    },
    {
      type: "footage", beats: 8, transition: "slide", layout: "side", side: "right", chapter: "Today", windowTitle: "Mizan — Today",
      clip: { source: "desktop", from: d.today + 0.4, speed: 1.4 },
      camera: [{ at: 0, z: 1, x: 0.5, y: 0.5 }, { at: 1, z: 1.5, x: 0.55, y: 0.22 }],
      kicker: "Today", title: "Start with today.", sub: "What's next, what matters most, and a quick check-in at night.",
    },
    {
      type: "footage", beats: 10, transition: "slide", layout: "stage", chapter: "Planner", windowTitle: "Mizan — Planner",
      clip: { source: "desktop", from: d.autoplan - 0.2, speed: 1.6 },
      camera: [{ at: 0, z: 1.1, x: 0.5, y: 0.35 }, { at: 0.25, z: 1.4, x: 0.35, y: 0.4 }, { at: 0.45, z: 1.4, x: 0.35, y: 0.4 }, { at: 0.62, z: 1.75, x: 0.27, y: 0.62 }, { at: 1, z: 1.85, x: 0.27, y: 0.62 }],
      kicker: "Planner", title: "Your day plans itself.", sub: "One click drops your open tasks into the free time.",
    },
    {
      type: "footage", beats: 8, transition: "pixels", layout: "stage", chapter: "Projects", windowTitle: "Mizan — Projects",
      clip: { source: "desktop", from: d.kanban + 0.8, speed: 2.5 },
      camera: [{ at: 0, z: 1.15, x: 0.6, y: 0.45 }, { at: 0.3, z: 1.6, x: 0.5, y: 0.52 }, { at: 1, z: 1.45, x: 0.45, y: 0.6 }],
      kicker: "Projects", title: "Move work forward.", sub: "A board for every project. Drag cards to reorder them.",
    },
    {
      type: "footage", beats: 10, transition: "slide", layout: "stage", chapter: "Tasks", windowTitle: "Mizan — Tasks",
      clip: { source: "desktop", from: d.steps + 0.8, speed: 2.9 },
      camera: [{ at: 0, z: 1.1, x: 0.5, y: 0.5 }, { at: 0.15, z: 1.55, x: 0.55, y: 0.42 }, { at: 0.72, z: 1.55, x: 0.55, y: 0.42 }, { at: 0.86, z: 1.7, x: 0.38, y: 0.68 }],
      kicker: "Tasks", title: "Big task? Break it down.", sub: "Paste a list. Every line becomes a step.",
    },
    {
      type: "footage", beats: 10, transition: "pixels", layout: "stage", chapter: "Focus", windowTitle: "Mizan — Focus",
      clip: { source: "desktop", from: d.focus + 0.4, speed: 2.1 },
      camera: [{ at: 0, z: 1.2, x: 0.56, y: 0.35 }, { at: 0.22, z: 1.75, x: 0.6, y: 0.52 }, { at: 0.7, z: 1.75, x: 0.6, y: 0.52 }, { at: 0.82, z: 1.55, x: 0.6, y: 0.4 }, { at: 1, z: 1.7, x: 0.6, y: 0.38 }],
      kicker: "Focus", title: "Then go deep.", sub: "Spin the wheels, start the timer. Distracting sites stay blocked.",
    },
    {
      type: "footage", beats: 6, transition: "slide", layout: "side", side: "right", chapter: "Log", windowTitle: "Mizan — Log",
      clip: { source: "desktop", from: d.log + 2, speed: 1.3 },
      camera: [{ at: 0, z: 1.3, x: 0.4, y: 0.4 }, { at: 1, z: 1.7, x: 0.36, y: 0.42 }],
      kicker: "Log", title: "Write the day down.", sub: "A note for every day. It saves itself.",
    },
    {
      type: "footage", beats: 8, transition: "slide", layout: "side", side: "left", chapter: "Stats", windowTitle: "Mizan — Stats",
      clip: { source: "desktop", from: d.stats + 1, speed: 2.2 },
      camera: [{ at: 0, z: 1.1, x: 0.6, y: 0.35 }, { at: 0.35, z: 1.5, x: 0.66, y: 0.45 }, { at: 1, z: 1.4, x: 0.66, y: 0.6 }],
      kicker: "Stats", title: "Watch yourself grow.", sub: "Focus time, streaks and finished tasks, from your real days.",
    },
    { type: "words", beats: 6, transition: "zoom", kicker: "Your phone joins in", words: ["Pair.", "Sync.", "Focus."] },
    {
      type: "phone", beats: 8, transition: "pixels", side: "right", chapter: "Second screen",
      clip: { source: "phone", from: p.focus + 5, speed: 1.6 },
      kicker: "Second screen", title: "A full-screen focus timer.", sub: "Prop your phone up. Picking it up counts as a distraction.",
    },
    {
      type: "phone", beats: 8, transition: "slide", side: "left", chapter: "On the go",
      clip: { source: "phone", from: p.tasks + 1.5, speed: 2 },
      kicker: "On the go", title: "Your tasks, in your pocket.", sub: "Pair with one QR code. Syncs over Wi-Fi, hotspot or a USB cable.",
      chips: ["No account", "Works offline"],
    },
    { type: "words", beats: 8, transition: "flash", energy: 2, kicker: "Private by design", words: ["No account.", "No cloud.", "No ads.", "Just you."] },
    {
      type: "outro", beats: 10, transition: "zoom", title: "MIZAN", tagline: "Balance your day.",
      cta: "Linux desktop · Android companion", footer: "Private · Offline-first · Yours",
    },
  ],
};
