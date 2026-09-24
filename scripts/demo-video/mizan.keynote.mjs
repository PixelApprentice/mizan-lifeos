// Mizan launch film: bright, calm, product-launch style (the "keynote" look).
// `pnpm demo:footage:light` once, then `pnpm demo:film` (add `--stills auto` for a quick preview).
//
// Story: the problem in one line → the promise → the name → the day, one benefit at a time →
// the phone → privacy → teams → everything at a glance → the name to remember.
// Scene lengths are in beats; footage times come from the marks the recorder writes.

import { existsSync, readFileSync } from "node:fs";

if (!existsSync("recordings/footage-light/marks.json")) throw new Error("No light footage yet. Run `pnpm demo:footage:light` first.");
const marks = JSON.parse(readFileSync("recordings/footage-light/marks.json", "utf8"));
const d = marks.desktop, p = marks.phone, r = marks.phoneRect;
const inset = 18; // phone stage border + bezel, in recorded pixels

export default {
  style: "keynote",
  out: "recordings/mizan-film.mp4",
  bpm: 96,
  fps: 30,
  poster: 12,
  icon: "public/mizan-icon.svg",
  theme: { accent: "#0b7a53", accent2: "#2f6fe0", accent3: "#b4569e" },
  footage: {
    desktop: { file: "recordings/footage-light/desktop.mp4" },
    phone: { file: "recordings/footage-light/phone.mp4", crop: [r.w - inset * 2, r.h - inset * 2, r.x + inset, r.y + inset] },
  },
  scenes: [
    { type: "statement", beats: 7, glow: 0.3, lines: ["Your day lives in", { t: "too many places.", tone: "dim" }] },
    { type: "statement", beats: 6, glow: 0.45, lines: ["What if it all", { t: "found its balance?", tone: "grad" }] },
    { type: "logo", beats: 8, glow: 0.9, title: "Mizan", tagline: "Plan. Focus. Reflect. In one calm place." },
    {
      type: "hero", beats: 10, kicker: "Today", lines: ["Your whole day.", { t: "At a glance.", tone: "dim" }],
      windowTitle: "Mizan — Today", clip: { source: "desktop", from: d.today + 0.3 },
      zoom: [{ at: 0, z: 1, x: 0.5, y: 0.3 }, { at: 6, z: 1.12, x: 0.55, y: 0.25 }],
    },
    {
      type: "feature", beats: 9, kicker: "Planner", lines: ["Your week,", { t: "planned for you.", tone: "grad" }],
      body: "Block out time with a drag. <b>Auto-plan</b> drops open tasks into the gaps.",
      windowTitle: "Mizan — Planner", clip: { source: "desktop", from: d.autoplan - 0.4 },
      zoom: [{ at: 0, z: 1.25, x: 0.55, y: 0.35 }, { at: 5.5, z: 1.4, x: 0.58, y: 0.45 }],
    },
    {
      type: "feature", side: "right", beats: 9, kicker: "Projects", lines: ["Move work", { t: "forward.", tone: "dim" }],
      body: "A board for every project. Drag a card, reorder, ship.",
      windowTitle: "Mizan — Projects", clip: { source: "desktop", from: d.kanban + 2, speed: 2 },
      zoom: [{ at: 0, z: 1.3, x: 0.55, y: 0.4 }, { at: 5.5, z: 1.4, x: 0.5, y: 0.45 }],
    },
    {
      type: "feature", beats: 9, kicker: "Tasks", lines: ["Big tasks.", { t: "Small steps.", tone: "dim" }],
      body: "Break anything down into steps you can <b>actually start</b>.",
      windowTitle: "Mizan — Tasks", clip: { source: "desktop", from: d.steps + 1, speed: 2.4 },
      zoom: [{ at: 0, z: 1.25, x: 0.55, y: 0.45 }, { at: 5.5, z: 1.35, x: 0.55, y: 0.4 }],
    },
    {
      type: "feature", side: "right", beats: 10, kicker: "Focus", lines: ["Then,", { t: "deep focus.", tone: "grad" }],
      body: "Name the goal, spin the wheels, begin. Distracting sites stay blocked.",
      windowTitle: "Mizan — Focus", clip: { source: "desktop", from: d.focus + 0.5, speed: 2 },
      zoom: [{ at: 0, z: 1.3, x: 0.6, y: 0.45 }, { at: 6, z: 1.35, x: 0.58, y: 0.55 }],
    },
    {
      type: "phone", beats: 11, kicker: "Phone", lines: ["Your phone,", { t: "a second screen.", tone: "dim" }],
      windowTitle: "Mizan — Focus", desktop: { source: "desktop", from: d.timer + 0.2, speed: 0.45 },
      desktopZoom: [{ at: 0, z: 1.15, x: 0.5, y: 0.4 }, { at: 7, z: 1.25, x: 0.48, y: 0.38 }],
      clip: { source: "phone", from: p.focus + 5, speed: 1.5 },
    },
    {
      type: "feature", beats: 9, kicker: "Log & Stats", lines: ["See how far", { t: "you've come.", tone: "grad" }],
      body: "A note for every day. Streaks and focus time, from your real days.",
      windowTitle: "Mizan — Stats", clip: { source: "desktop", from: d.stats + 1, speed: 1.2 },
      zoom: [{ at: 0, z: 1.3, x: 0.55, y: 0.35 }, { at: 5.5, z: 1.4, x: 0.6, y: 0.45 }],
    },
    {
      type: "feature", side: "right", beats: 8, kicker: "Appearance", lines: ["Light.", { t: "Or dark.", tone: "dim" }],
      body: "Your call. Or let it follow your system.",
      windowTitle: "Mizan — Settings", clip: { source: "desktop", from: d.appearance + 0.4 },
      zoom: [{ at: 0, z: 1.45, x: 0.55, y: 0.32 }, { at: 5, z: 1.5, x: 0.55, y: 0.3 }],
    },
    { type: "list", beats: 9, glow: 0.4, items: ["No account.", "No cloud.", "No ads."], final: "Your data stays yours." },
    {
      type: "feature", beats: 9, kicker: "Teams", lines: ["Ready when", { t: "your team is.", tone: "grad" }],
      body: "Projects, sprints and boards, hosted <b>on your own network</b>.",
      windowTitle: "Mizan — Acme Studio", clip: { source: "desktop", from: d.team - 0.6, speed: 0.85 },
      zoom: [{ at: 0, z: 1.3, x: 0.6, y: 0.35 }, { at: 5.5, z: 1.4, x: 0.6, y: 0.4 }],
    },
    {
      type: "grid", beats: 10, glow: 0.5, cols: 4, lines: ["Everything you need.", { t: "Nothing you don't.", tone: "dim" }],
      tiles: [
        { big: "Today", label: "Your day at a glance" },
        { big: "Planner", label: "Time blocks and auto-plan" },
        { big: "Projects", label: "Boards that move" },
        { big: "Focus", label: "Timer and site blocker", dark: true },
        { big: "Log", label: "A note for every day" },
        { big: "Stats", label: "Streaks and trends" },
        { big: "Your phone", label: "Syncs over Wi-Fi, hotspot or USB", grad: true, span: 2 },
      ],
    },
    { type: "end", beats: 10, glow: 0.8, title: "Mizan", tagline: "Balance your day.", cta: "Free and open source", fine: "For Linux and Android" },
  ],
};
