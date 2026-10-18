// Mizan cinema cut: real 3D laptop and phone in a dark studio, one continuous camera,
// an arranged score with interface sounds on every recorded click and keystroke.
// `pnpm demo:footage:cinema` once, then `pnpm demo:cinema` (add `--stills auto` for a quick preview).
//
// Story: the problem → the promise → the lid opens → the day, one benefit per camera move →
// the phone joins → privacy → teams → everything → the name to remember.
// Scene lengths are in beats; footage times come from the marks the recorder writes.
// Camera keys: on = what to look at, focus = point on that screen (0..1), dist/yaw/pitch
// orbit around it, shift = where the subject sits in the frame (fractions of the frame).

import { existsSync, readFileSync } from "node:fs";

const DIR = "recordings/footage-cinema";
if (!existsSync(`${DIR}/marks.json`)) throw new Error("No cinema footage yet. Run `pnpm demo:footage:cinema` first.");
const marks = JSON.parse(readFileSync(`${DIR}/marks.json`, "utf8"));
const d = marks.desktop, p = marks.phone, r = marks.phoneRect;
const inset = 24; // phone stage border + bezel, in recorded pixels (2x)

export default {
  style: "cinema",
  out: "recordings/mizan-cinema.mp4",
  bpm: 112,
  fps: 30,
  poster: 16.4,
  workers: 3,
  brand: "Mizan",
  icon: "public/mizan-icon.svg",
  theme: { accent: "#34d399" },
  world: { bg: "#050607", mac: "spaceBlack", iphone: "silver", phone: [2.4, 1.0, 0.5], phoneYaw: -0.34, handheld: 1, screenGain: 0.86 },
  footage: {
    desktop: { file: `${DIR}/desktop.mp4`, events: marks.events?.desktop },
    phone: { file: `${DIR}/phone.mp4`, events: marks.events?.phone, crop: [r.w - inset * 2, r.h - inset * 2, r.x + inset, r.y + inset] },
  },
  scenes: [
    {
      type: "title", beats: 8, mood: 0, lines: ["Your day lives in", { t: "too many places.", tone: "dim" }],
      world: { exposure: 0.16, bars: 1 }, lid: [[0, 0]],
      cam: [{ at: 0, on: "point", point: [0, 0.15, 0], dist: 5.2, yaw: 48, pitch: 4, fov: 28, shift: [0, 0.26] }, { at: "end", yaw: 30, dist: 4.6, pitch: 6 }],
    },
    {
      type: "title", beats: 6, mood: 1, lines: ["What if it all", { t: "found its balance?", tone: "grad" }],
      world: { exposure: 0.3, bars: 1 }, fly: 0.01,
      cam: [{ at: 0, yaw: 30, dist: 4.6 }, { at: "end", yaw: 18, dist: 4.1, pitch: 8, point: [0, 0.3, -0.2] }],
    },
    {
      type: "shot", beats: 12, mood: 1, riser: true, screenShow: "logo", caption: "Plan. Focus. Reflect. In one calm place.", captionAt: 3.2,
      world: { exposure: 1, bars: 0 }, worldIn: 2.6, fly: 0.01, lid: [[0.25, 0], [3.0, 1]],
      cam: [
        { at: 0, on: "point", point: [0, 0.3, -0.2], yaw: 18, dist: 4.1, pitch: 8 },
        { at: 3.2, on: "laptop", focus: [0.5, 0.62], dist: 5.6, yaw: 4, pitch: 9, fov: 30, shift: [0, 0], ease: "inOutCubic" },
        { at: "end", dist: 5.0, yaw: 0, pitch: 8 },
      ],
    },
    {
      type: "shot", beats: 10, mood: 3, drop: true, flash: true, side: "top", size: "m", kicker: "Today", lines: ["Your whole day.", { t: "At a glance.", tone: "dim" }],
      screen: { source: "desktop", from: d.today + 0.3 }, fly: 0.9,
      cam: [{ at: 0, on: "laptop", focus: [0.5, 0.5], dist: 5.5, yaw: -6, pitch: 5, shift: [0, 0.2] }, { at: "end", dist: 4.95, yaw: 4, focus: [0.48, 0.48] }],
    },
    {
      type: "shot", beats: 9, mood: 2, side: "left", kicker: "Planner", lines: ["Your week,", { t: "planned for you.", tone: "grad" }],
      body: "Block out time with a drag. <b>Auto-plan</b> drops open tasks into the gaps.",
      screen: { source: "desktop", from: d.autoplan - 0.4 },
      cam: [{ at: 0, focus: [0.5, 0.45], dist: 4.95, yaw: 30, pitch: 6, shift: [0.22, 0] }, { at: "end", dist: 4.4, yaw: 22, focus: [0.52, 0.48] }],
    },
    {
      type: "shot", beats: 9, mood: 2, side: "right", kicker: "Projects", lines: ["Move work", { t: "forward.", tone: "dim" }],
      body: "A board for every project. Drag a card, reorder, ship.",
      screen: { source: "desktop", from: d.kanban + 2, speed: 2, foley: 0.7 },
      cam: [{ at: 0, focus: [0.5, 0.45], dist: 5.06, yaw: -30, pitch: 8, shift: [-0.22, 0] }, { at: "end", dist: 4.51, yaw: -22, focus: [0.48, 0.5] }],
    },
    {
      type: "shot", beats: 9, mood: 2, side: "left", kicker: "Tasks", lines: ["Big tasks.", { t: "Small steps.", tone: "dim" }],
      body: "Break anything down into steps you can <b>actually start</b>.",
      screen: { source: "desktop", from: d.steps + 1, speed: 2.4, foley: 0.5 },
      cam: [{ at: 0, focus: [0.5, 0.42], dist: 4.73, yaw: 26, pitch: 3, roll: -1.2, shift: [0.22, 0] }, { at: "end", dist: 4.18, yaw: 18, roll: 0 }],
    },
    {
      type: "shot", beats: 10, mood: 3, side: "right", kicker: "Focus", lines: ["Then,", { t: "deep focus.", tone: "grad" }],
      body: "Name the goal, spin the wheels, begin. Distracting sites stay blocked.",
      screen: { source: "desktop", from: d.focus + 0.5, speed: 2 },
      cam: [{ at: 0, focus: [0.5, 0.5], dist: 5.06, yaw: -32, pitch: -1, shift: [-0.22, 0.02] }, { at: "end", dist: 4.62, yaw: -25, pitch: 2 }],
    },
    {
      type: "shot", beats: 12, mood: 2, side: "right", kicker: "Phone", lines: ["Your phone,", { t: "a second screen.", tone: "dim" }],
      body: "Pair once with a QR code. Syncs over Wi-Fi, hotspot or USB.",
      screen: { source: "desktop", from: d.timer + 0.2, speed: 0.45 }, phone: { source: "phone", from: p.focus + 5, speed: 1.5 }, phoneAt: 0.1, fly: 1.4,
      cam: [
        { at: 0, on: "point", point: [1.3, 0.95, 0.1], dist: 7.6, yaw: 16, pitch: 8, shift: [-0.12, 0] },
        { at: 3.4, on: "phone", focus: [0.5, 0.5], dist: 4.4, yaw: 30, pitch: 4, shift: [-0.2, 0], ease: "inOutCubic" },
        { at: "end", dist: 3.9, yaw: 22 },
      ],
    },
    {
      type: "shot", beats: 9, mood: 2, side: "left", kicker: "Log & Stats", lines: ["See how far", { t: "you've come.", tone: "grad" }],
      body: "A note for every day. Streaks and focus time, from your real days.",
      screen: { source: "desktop", from: d.stats + 1, speed: 1.2 }, fly: 1.3,
      cam: [{ at: 0, on: "laptop", focus: [0.5, 0.45], dist: 4.95, yaw: 28, pitch: 10, shift: [0.22, 0] }, { at: "end", dist: 4.62, yaw: 24 }],
    },
    {
      type: "shot", beats: 8, mood: 2, side: "right", kicker: "Appearance", lines: ["Light.", { t: "Or dark.", tone: "dim" }],
      body: "Your call. Or let it follow your system.",
      screen: { source: "desktop", from: d.appearance + 0.4 },
      cam: [{ at: 0, focus: [0.5, 0.4], dist: 4.95, yaw: -28, pitch: 12, shift: [-0.22, 0] }, { at: "end", dist: 4.4, yaw: -20 }],
    },
    {
      type: "list", beats: 10, mood: 0, items: ["No account.", "No cloud.", "No ads."], final: "Your data stays yours.",
      screen: { source: "desktop", from: d.appearance + 4 }, world: { blur: 22, dim: 0.5 }, fly: 1.4,
      cam: [{ at: 0, on: "point", point: [0, 0.8, 0], dist: 7, yaw: -30, pitch: 18 }, { at: "end", yaw: -50, dist: 6.4 }],
    },
    {
      type: "shot", beats: 9, mood: 3, drop: true, flash: true, side: "left", kicker: "Teams", lines: ["Ready when", { t: "your team is.", tone: "grad" }],
      body: "Projects, sprints and boards, hosted <b>on your own network</b>.",
      screen: { source: "desktop", from: d.team - 0.6, speed: 0.85 }, world: { blur: 0, dim: 0 }, worldIn: 0.5, fly: 0.8,
      cam: [{ at: 0, on: "laptop", focus: [0.5, 0.42], dist: 4.95, yaw: 28, pitch: 7, shift: [0.22, 0] }, { at: "end", dist: 4.4, yaw: 20 }],
    },
    {
      type: "grid", beats: 10, mood: 2, cols: 4, lines: ["One app", { t: "for your whole day.", tone: "dim" }],
      screen: { source: "desktop", from: d.today + 2 }, world: { blur: 26, dim: 0.55 }, fly: 1.2,
      cam: [{ at: 0, on: "point", point: [0, 0.9, 0], dist: 6.5, yaw: 35, pitch: 14 }, { at: "end", yaw: 55, dist: 6 }],
      tiles: [
        { big: "Today", label: "Your day at a glance" },
        { big: "Planner", label: "Time blocks and auto-plan" },
        { big: "Projects", label: "Boards you can reorder" },
        { big: "Focus", label: "Timer and site blocker" },
        { big: "Log", label: "A note for every day" },
        { big: "Stats", label: "Streaks and focus time" },
        { big: "Phone", label: "Pairs over Wi-Fi or USB" },
        { big: "Teams", label: "Boards on your own network" },
      ],
    },
    {
      type: "end", beats: 14, mood: 0, top: 96, title: "Mizan", tagline: "Balance your day.", cta: "Free and open source", fine: "For Linux and Android",
      screen: { source: "desktop", from: d.today + 1 }, phone: { source: "phone", from: p.zen + 1 }, phoneAt: 0.4,
      world: { blur: 0, dim: 0.25 }, fly: 1.6,
      cam: [{ at: 0, on: "point", point: [0.7, 0.9, 0.1], dist: 12.5, yaw: 6, pitch: 9, shift: [0, 0.34] }, { at: "end", dist: 11.6, yaw: -2 }],
    },
  ],
};
