#!/usr/bin/env node
// Records a captioned product tour of Mizan and writes recordings/mizan-demo.mp4.
//
//   pnpm demo:video              captioned walkthrough → recordings/mizan-demo.mp4
//   pnpm demo:video --footage    clean 1080p footage + scene marks → recordings/footage/
//                                (raw material for the trailer: pnpm demo:trailer)
//   add --theme light            record the light theme instead → recordings/footage-light/
//                                (raw material for the keynote film: pnpm demo:film)
//   add --dpr 2 --out <dir>      sharper pixels for deep camera push-ins, written to <dir>
//                                (raw material for the 3D cinema cut: pnpm demo:cinema)
//
// Desktop scenes run in the browser preview (demo data, nothing touches your real
// database). Phone scenes run the real companion page against a mock desktop.
// Needs: playwright-core's Chromium (`npx playwright-core install chromium`) and ffmpeg.

import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { overlay, stageHtml } from "./overlay.mjs";
import { startMockDesktop, TOKEN, DESKTOP_ID } from "./mock-desktop.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "recordings");
const RAW_DIR = path.join(OUT_DIR, ".raw");
const VITE_PORT = 5210;
const MOCK_PORT = 5211;
const APP = `http://127.0.0.1:${VITE_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const SIZE = { width: 1280, height: 720 };
const PHONE_SCALE = 0.74;
const FADE = 0.6;
// Footage mode: no captions or cards, recorded at 1.5x pixel density for sharp zooms.
const FOOTAGE = process.argv.includes("--footage");
const DPR = FOOTAGE ? Number(process.argv.includes("--dpr") ? process.argv[process.argv.indexOf("--dpr") + 1] : 1.5) : 1;
const VIDEO = { width: SIZE.width * DPR, height: SIZE.height * DPR };
const THEME = process.argv.includes("--theme") ? process.argv[process.argv.indexOf("--theme") + 1] : "dark";
const OUT_ARG = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const FOOTAGE_DIR = OUT_ARG ? path.resolve(OUT_ARG) : path.join(OUT_DIR, THEME === "light" ? "footage-light" : "footage");

// ---------------- helpers ----------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = path.join(homedir(), ".cache/ms-playwright");
  if (!existsSync(cache)) return undefined;
  for (const dir of readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const candidate = path.join(cache, dir, sub);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

async function waitForHttp(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`${url} did not start`);
}

async function centerOf(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No box for ${locator}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Input events of the current take (clicks, keys, drags, wheel ticks), saved next to the
// marks so the soundtrack can put a sound on each one.
let EVENTS = null;
const event = (kind, delay = 0) => EVENTS?.list.push({ t: +((Date.now() - EVENTS.born) / 1000 + delay).toFixed(3), kind });

// Moves like a hand: eases in and out along a slight arc, slower for longer distances.
async function glide(page, x, y, ms = 650) {
  const from = page.__pos || { x: SIZE.width / 2, y: SIZE.height / 2 };
  const dx = x - from.x, dy = y - from.y, dist = Math.hypot(dx, dy);
  const dur = Math.max(ms * 0.6, Math.min(ms * 1.3, 260 + dist * 0.85));
  const n = Math.max(10, Math.round(dur / 16));
  const bow = Math.min(50, dist * 0.1) * (Math.round(x + y) % 2 ? 1 : -1);
  const nx = -dy / (dist || 1), ny = dx / (dist || 1);
  for (let i = 1; i <= n; i++) {
    const k = i / n, e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2, b = Math.sin(Math.PI * e) * bow;
    await page.mouse.move(from.x + dx * e + nx * b, from.y + dy * e + ny * b);
    await sleep(14);
  }
  page.__pos = { x, y };
}

async function click(page, locator, pause = 250) {
  const p = await centerOf(locator);
  await glide(page, p.x, p.y);
  await sleep(140);
  event("click");
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(pause);
}

async function type(page, locator, text, delay = 42) {
  await click(page, locator, 120);
  [...text].forEach((c, i) => event(c === " " ? "space" : "key", (i * delay) / 1000));
  await page.keyboard.type(text, { delay });
}

async function drag(page, handle, to) {
  const from = await centerOf(handle);
  await glide(page, from.x, from.y);
  await sleep(200);
  event("grab");
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y + 6, { steps: 4 });
  page.__pos = { x: from.x + 4, y: from.y + 6 };
  await glide(page, to.x, to.y, 1100);
  await sleep(350);
  event("drop");
  await page.mouse.up();
  await sleep(600);
}

async function wheel(page, locator, total, step = 44, every = 70) {
  const p = await centerOf(locator);
  await glide(page, p.x, p.y);
  for (let moved = 0; Math.abs(moved) < Math.abs(total); moved += Math.sign(total) * step) {
    event("tick");
    await page.mouse.wheel(0, Math.sign(total) * step);
    await sleep(every);
  }
  await sleep(700);
}

async function scrollBy(page, total, step = 40) {
  for (let moved = 0; moved < Math.abs(total); moved += step) {
    await page.mouse.wheel(0, Math.sign(total) * step);
    await sleep(24);
  }
}

const caption = (page, kicker, title, sub) => FOOTAGE ? Promise.resolve() : page.evaluate(([k, t, s]) => window.__demo.caption(k, t, s), [kicker, title, sub]);
const nav = (page, name) => click(page, page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: new RegExp(`^${name}`) }), 900);

// Realistic history for the Stats scene, written into the preview's in-memory demo store.
async function seedHistory(page) {
  await page.evaluate(async () => {
    const { demo } = await import("/src/lib/api.ts");
    const pad = (n) => String(n).padStart(2, "0");
    const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const rfc = (d) => {
      const off = -d.getTimezoneOffset(), a = Math.abs(off);
      return `${day(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${off >= 0 ? "+" : "-"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
    };
    const plan = [50, 90, 0, 75, 50, 120, 25, 90, 50, 0, 100, 75, 50, 90, 60, 0, 120, 90, 50, 75, 25, 90, 0, 110, 50, 90, 75, 60];
    const reasons = ["Opened YouTube 'for music'", "Family call — needed to answer"];
    let broken = 0;
    for (let i = plan.length; i >= 1; i--) {
      const minutes = plan[plan.length - i];
      if (!minutes) continue;
      const start = new Date(); start.setDate(start.getDate() - i); start.setHours(9, 0, 0, 0);
      const isBroken = i === 9 || i === 3;
      const actual = isBroken ? Math.round(minutes * 0.4) : minutes;
      const end = new Date(start.getTime() + actual * 60000);
      demo.sessions.push({ started_at: rfc(start), ended_at: rfc(end), planned_min: minutes, actual_min: actual, broken: isBroken,
        reason: isBroken ? reasons[broken++ % 2] : "", kills: isBroken ? 1 : 0, phone_leaves: i % 4 === 0 ? 1 : 0 });
    }
    const titles = ["Morning run", "Read 30 pages", "Finish chapter 3 notes", "Call grandma", "Submit the assignment", "Practice guitar",
      "Clean the inbox", "Gym: legs day", "Draft the essay outline", "Groceries for the week", "Review flashcards", "Read one chapter", "Plan next week"];
    titles.forEach((title, n) => {
      const done = new Date(); done.setDate(done.getDate() - (n % 12) - 1);
      demo.tasks.push({ id: 200 + n, title, notes: "", kind: n % 3 ? "code" : "study", status: "done", parent_id: null, est_min: 30, due: null,
        created_at: `${day(done)} 08:00:00`, completed_at: `${day(done)} 16:00:00`, project_id: n % 2 ? 1 : 2, priority: 2 });
    });
    // A lived-in week around the current hour, so the planner never looks empty on camera.
    const h0 = Math.min(18, Math.max(6, new Date().getHours() - 1));
    const at = (offset, h, m) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${day(d)}T${pad(h0 + h)}:${pad(m)}:00`; };
    const week = [
      [0, 1, 30, 2, 0, "Lunch + walk", "#eab308"], [0, 3, 30, 4, 30, "Call with mentor", "#a78bfa"],
      [1, 0, 0, 1, 30, "Class: data structures", ""], [1, 3, 0, 4, 30, "Study group", "#a78bfa"],
      [2, 1, 30, 2, 30, "Gym", "#eab308"], [2, 4, 0, 5, 0, "Read", ""],
      [3, 0, 30, 2, 0, "Deep work: essay", ""], [3, 2, 30, 3, 30, "Lunch with Sara", "#f472b6"],
      [4, 1, 0, 2, 0, "Groceries", "#eab308"], [5, 3, 0, 4, 0, "Family call", "#f472b6"],
      [6, 0, 0, 2, 0, "Deep work: project", ""], [6, 3, 0, 4, 0, "Weekly review", "#a78bfa"],
    ];
    for (const [d, h1, m1, h2, m2, title, color] of week) {
      demo.events.push({ id: demo.nextId++, title, start: at(d, h1, m1), end: at(d, h2, m2), task_id: null, color, done: 0 });
    }
  });
}

// Normal mode uses Playwright's recorder. Footage mode needs real 1.5x pixels, which the
// recorder drops (it captures at CSS size), so it reads Chromium's screencast directly.
function newContext(browser) {
  const base = { viewport: SIZE, deviceScaleFactor: DPR, colorScheme: THEME === "light" ? "light" : "dark" };
  return browser.newContext(FOOTAGE ? base : { ...base, recordVideo: { dir: RAW_DIR, size: VIDEO } });
}

async function startCapture(page, born, name) {
  if (!FOOTAGE) return null;
  const dir = path.join(RAW_DIR, `cap-${name}`);
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `${String(frames.length).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp - born / 1000 });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VIDEO.width, maxHeight: VIDEO.height, everyNthFrame: 1 });
  return { cdp, frames, dir, name };
}

// Turns the variable-rate screencast into a constant 30 fps clip whose t=0 is `born`.
async function stopCapture(capture, context, page) {
  if (!capture) {
    await context.close();
    return page.video().path();
  }
  await capture.cdp.send("Page.stopScreencast").catch(() => {});
  await sleep(300);
  await context.close();
  const { frames, dir } = capture;
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : f.t + 0.5;
    const start = i === 0 ? 0 : f.t;
    lines.push(`file '${path.basename(f.file)}'`, `duration ${Math.max(0.001, next - start).toFixed(4)}`);
  });
  lines.push(`file '${path.basename(frames.at(-1).file)}'`);
  writeFileSync(path.join(dir, "list.txt"), lines.join("\n") + "\n");
  const out = path.join(RAW_DIR, `${capture.name}.mp4`);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-vf", `fps=30,scale=${VIDEO.width}:${VIDEO.height}:force_original_aspect_ratio=decrease,pad=${VIDEO.width}:${VIDEO.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-g", "15", out]);
  return out;
}

// Named timestamps (seconds into the raw recording) that the trailer cuts on.
function marker(born) {
  const marks = {};
  EVENTS = { born, list: [] };
  return { marks, events: EVENTS.list, mark: (name) => { marks[name] = +((Date.now() - born) / 1000).toFixed(2); } };
}

// ---------------- scenes ----------------

async function recordDesktop(browser) {
  const context = await newContext(browser);
  await context.addInitScript(overlay);
  await context.addInitScript((theme) => { try { localStorage.setItem("mizan.theme", theme); } catch { /* preview only */ } }, THEME);
  const page = await context.newPage();
  const born = Date.now();
  const capture = await startCapture(page, born, "desktop");
  const { marks, mark, events } = marker(born);
  await page.goto(`${APP}/#/`);
  await page.evaluate((clean) => window.__demo.card(clean ? { kicker: "", title: "" } : {
    kicker: "Meet Mizan",
    title: "One calm place for your whole day",
    sub: "Plan it, do the work, reflect on it. A private planner for your computer, with your phone as a sidekick.",
    items: ["Today at a glance", "Auto-planned calendar", "Kanban boards", "Deep-focus timer", "Daily log", "Honest stats"],
  }), FOOTAGE);
  const trim = (Date.now() - born) / 1000 + 0.15;
  await seedHistory(page);
  // Load every lazy view behind the title card so no "Loading view..." frame is filmed.
  for (const route of ["planner", "projects", "tasks", "focus", "log", "stats", ""]) {
    await page.evaluate((r) => { location.hash = `#/${r}`; }, route);
    await sleep(500);
  }
  await sleep(2700);
  await page.evaluate(() => window.__demo.hideCard());
  await sleep(500);
  mark("today");

  await caption(page, "Today", "Your day at a glance", "What's next on the calendar, what matters most, and a quick evening check-in.");
  await glide(page, 900, 300, 900);
  await sleep(1800);
  mark("tick");
  await click(page, page.getByLabel("Complete Read one chapter"), 1600);

  // Planner + auto-plan
  await nav(page, "planner");
  mark("planner");
  await caption(page, "Planner", "Your week, in time blocks", "Drag to create or move blocks. Auto-plan drops your open tasks into the free time.");
  await sleep(1200);
  await click(page, page.getByText("Planning tools & unplanned tasks"), 700);
  mark("autoplan");
  await click(page, page.getByRole("button", { name: /auto-plan open tasks/ }), 900);
  await click(page, page.getByText("Planning tools & unplanned tasks"), 500);
  await glide(page, 340, 470, 800);
  await sleep(2600);

  // Kanban
  await nav(page, "projects");
  mark("kanban");
  await caption(page, "Projects", "Move work forward", "A board for every project. Drag cards to reorder them or move them along.");
  await sleep(900);
  const buildHandle = page.locator('[aria-label="Drag Build a first draft"]');
  const reviewHandle = page.locator('[aria-label="Drag Review and test"]');
  const above = await buildHandle.boundingBox();
  await drag(page, reviewHandle, { x: above.x + above.width / 2, y: above.y - 6 });
  await sleep(500);
  const doing = await page.locator('[aria-label="Drag Define the next milestone"]').boundingBox();
  await drag(page, buildHandle, { x: doing.x + 60, y: doing.y + 230 });
  await sleep(900);
  mark("menu");
  const reviewCard = page.locator("[data-task-id]").filter({ hasText: "Review and test" });
  await glide(page, ...Object.values(await centerOf(reviewCard)), 500);
  await click(page, page.getByRole("button", { name: "Actions for Review and test" }), 700);
  await click(page, page.getByRole("menuitem", { name: /^Move to doing$/i }), 1200);

  // Break into steps
  await nav(page, "tasks");
  mark("steps");
  await caption(page, "Tasks", "Big task? Break it down", "Pick suggested steps or paste any list. Every line becomes a step.");
  await sleep(700);
  const row = page.locator("li.panel").filter({ has: page.getByLabel("Complete Build a first draft", { exact: true }) });
  await click(page, row.getByRole("button", { name: "Break into steps" }), 1600);
  const dialog = page.getByRole("dialog");
  await click(page, dialog.getByText("Paste or type your own list"), 400);
  await type(page, dialog.getByLabel("Steps, one per line"), "Outline the sections\nWrite the intro\nAdd sources", 34);
  await sleep(300);
  await click(page, dialog.getByRole("button", { name: "Use this list" }), 1200);
  await click(page, dialog.getByRole("button", { name: /^Add \d+ steps?$/ }), 1000);
  mark("stepsAdded");
  await caption(page, "Tasks", "Small steps, real progress", "Tick them off one by one, right under the task.");
  await click(page, page.getByLabel("Complete step Outline the sections"), 1800);

  // Focus + wheels
  await nav(page, "focus");
  mark("focus");
  await caption(page, "Focus", "Then go deep", "Name the goal, spin the wheels like the Clock app, and start. Distracting sites can stay blocked.");
  await type(page, page.getByLabel("Session goal"), "Finish the essay draft");
  await sleep(300);
  await wheel(page, page.getByRole("listbox", { name: "Hours" }), 44);
  await wheel(page, page.getByRole("listbox", { name: "Minutes" }), -880, 88, 60);
  await sleep(600);
  await click(page, page.getByRole("button", { name: "Begin session" }), 900);
  mark("timer");
  await caption(page, "Focus", "One thing at a time", "The timer follows you around the app, or goes full screen on your phone.");
  await sleep(3600);

  // Log
  await nav(page, "log");
  mark("log");
  await caption(page, "Log", "Write the day down", "A Markdown note for every day, with templates. It saves itself.");
  await sleep(600);
  const logBox = page.getByLabel("Daily log");
  await click(page, logBox, 200);
  await page.evaluate(() => {
    const t = document.querySelector('textarea[aria-label="Daily log"]');
    const i = t.value.indexOf("1.") + 2;
    t.setSelectionRange(i, i);
  });
  await page.keyboard.type(" Finish the essay draft", { delay: 45 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type(" Gym after class", { delay: 45 });
  await sleep(1600);

  // Stats
  await nav(page, "stats");
  mark("stats");
  await caption(page, "Stats", "See yourself improve", "Focus time, streaks and finished tasks, all from your real days.");
  await sleep(1500);
  await click(page, page.getByRole("button", { name: "28 days" }), 1600);
  await glide(page, 760, 420, 500);
  await scrollBy(page, 520);
  await sleep(2400);
  await scrollBy(page, 420);
  await sleep(2200);
  await page.evaluate(() => window.__demo.clearCaption());
  await sleep(400);

  // Appearance: flip to the other theme and back.
  await nav(page, "settings");
  await page.evaluate(() => document.querySelector(".app-content")?.scrollTo(0, 0));
  mark("appearance");
  await caption(page, "Settings", "Light or dark", "Pick a look, or let it follow your system.");
  await sleep(900);
  const other = THEME === "light" ? "Dark" : "Light";
  const mine = THEME === "light" ? "Light" : "Dark";
  await click(page, page.getByRole("radio", { name: new RegExp(`^${other}`) }), 1700);
  await click(page, page.getByRole("radio", { name: new RegExp(`^${mine}`) }), 1500);

  // Team workspace board.
  await click(page, page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Acme Studio" }), 1800);
  mark("team");
  await caption(page, "Teams", "Ready for your team", "Projects, sprints and boards, hosted on your own network.");
  await glide(page, 760, 420, 900);
  await sleep(3200);

  mark("end");
  const file = await stopCapture(capture, context, page);
  return { file, trim, marks, events };
}

async function recordPhone(browser, mock) {
  const context = await newContext(browser);
  await context.addInitScript(overlay);
  const page = await context.newPage();
  const born = Date.now();
  const capture = await startCapture(page, born, "phone");
  const { marks, mark, events } = marker(born);
  await page.goto(`${MOCK}/stage`);
  const trim = (Date.now() - born) / 1000 + 0.15;
  const phone = page.frameLocator("#phone");
  const box = await page.locator(".phone").boundingBox();
  const phoneRect = { x: Math.round(box.x * DPR), y: Math.round(box.y * DPR), w: Math.round(box.width * DPR), h: Math.round(box.height * DPR) };
  const say = (k, t, s, chips) => FOOTAGE ? Promise.resolve() : page.evaluate(([a, b, c, d]) => window.say(a, b, c, d), [k, t, s, chips]);

  await say("Phone companion", "Your phone joins in", "Scan one QR code to pair. Wi-Fi, your hotspot or a USB cable all work.", ["No account", "No cloud", "Pair once"]);
  await phone.locator("#status").filter({ hasText: "workstation" }).waitFor({ timeout: 15000 });
  mark("pair");
  await glide(page, 700, 400, 600);
  await sleep(3500);

  await say("On the go", "Your tasks in your pocket", "Add and tick off tasks anywhere. Everything syncs when your phone and computer meet.", ["Works offline", "Syncs both ways"]);
  mark("tasks");
  await click(page, phone.locator('nav button[data-view="tasks"]'), 900);
  await type(page, phone.locator("#add-input"), "Buy a birthday gift");
  await page.keyboard.press("Enter");
  await sleep(1200);
  await click(page, phone.getByLabel("Complete Write the intro"), 2200);

  await say("Agenda", "Today's plan, always with you", "Your calendar blocks, ready to tick off as you go.");
  mark("agenda");
  await click(page, phone.locator('nav button[data-view="agenda"]'), 2600);

  await say("Second screen", "Start focus from your phone", "The same wheels. Your computer blocks the distractions.");
  mark("focus");
  await click(page, phone.locator('nav button[data-view="focus"]'), 700);
  await type(page, phone.locator("#intent"), "Write the essay draft");
  await wheel(page, phone.locator("#wheel-m"), -440, 44, 70);
  await click(page, phone.locator("#start-btn"), 1200);
  await click(page, phone.locator("#zen-btn"), 400);
  mark("zen");
  await say("Second screen", "A full-screen focus timer", "Prop your phone up next to the screen. Picking it up mid-session counts as a distraction.", ["Screen stays on", "Full screen", "Park a thought"]);
  await glide(page, 600, 380, 700);
  await sleep(4200);
  const clock = await centerOf(phone.locator("#clock"));
  await glide(page, clock.x, clock.y);
  for (let i = 0; i < 3; i++) { await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(120); }
  await sleep(600);

  await say("Anywhere", "No Wi-Fi? Still works", "Use your phone's hotspot or a USB cable. The phone finds your computer by itself.", ["Hotspot", "USB cable", "Finds it again"]);
  mark("nowifi");
  await click(page, phone.locator('nav button[data-view="pair"]'), 800);
  await glide(page, 1040, 520, 500);
  await scrollBy(page, 360);
  await sleep(4200);

  mark("end");
  if (!FOOTAGE) await page.evaluate(() => window.__demo.card({
    kicker: "Mizan",
    title: "Balance your day.",
    sub: "Private by design: your plans live on your own computer, not in someone's cloud.",
    items: ["No account", "No ads, no tracking", "Works offline", "Linux desktop", "Android companion"],
  }));
  if (!FOOTAGE) await sleep(6500);

  const file = await stopCapture(capture, context, page);
  return { file, trim, received: mock.received, marks, phoneRect, events };
}

// ---------------- assembly ----------------

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

function duration(file) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}

function assemble(segments, out) {
  const clips = segments.map((s, i) => {
    const clip = path.join(RAW_DIR, `segment-${i}.mp4`);
    ffmpeg(["-i", s.file, "-ss", s.trim.toFixed(2), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-an", clip]);
    return clip;
  });
  const first = duration(clips[0]);
  ffmpeg(["-i", clips[0], "-i", clips[1], "-filter_complex",
    `[0:v][1:v]xfade=transition=fade:duration=${FADE}:offset=${(first - FADE).toFixed(2)},format=yuv420p[v]`,
    "-map", "[v]", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", out]);
  ffmpeg(["-ss", "3", "-i", out, "-frames:v", "1", path.join(OUT_DIR, "mizan-demo-poster.png")]);
}

// Keeps the raw timing (marks are seconds into each file) and re-encodes for fast seeking.
function saveFootage(desktop, phone) {
  mkdirSync(FOOTAGE_DIR, { recursive: true });
  for (const [name, take] of [["desktop", desktop], ["phone", phone]]) {
    ffmpeg(["-i", take.file, "-c", "copy", path.join(FOOTAGE_DIR, `${name}.mp4`)]);
  }
  const marks = {
    size: VIDEO,
    desktop: desktop.marks,
    phone: phone.marks,
    phoneRect: phone.phoneRect,
    events: { desktop: desktop.events, phone: phone.events },
  };
  writeFileSync(path.join(FOOTAGE_DIR, "marks.json"), JSON.stringify(marks, null, 2) + "\n");
}

// ---------------- main ----------------

async function main() {
  rmSync(RAW_DIR, { recursive: true, force: true });
  mkdirSync(RAW_DIR, { recursive: true });

  const vite = spawn(path.join(ROOT, "node_modules/.bin/vite"), ["--port", String(VITE_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  const mock = await startMockDesktop({
    port: MOCK_PORT,
    pagePath: path.join(ROOT, "companion/index.html"),
    stageHtml: stageHtml(`/index.html#pair=${TOKEN}&id=${DESKTOP_ID}`, PHONE_SCALE),
  });
  let browser;
  try {
    await waitForHttp(APP);
    browser = await chromium.launch({ executablePath: findChromium() });
    console.log("Recording desktop scenes…");
    const desktop = await recordDesktop(browser);
    console.log("Recording phone scenes…");
    const phone = await recordPhone(browser, mock);
    if (!phone.received.includes("Buy a birthday gift")) throw new Error("The phone's new task never reached the mock desktop.");
    if (FOOTAGE) {
      saveFootage(desktop, phone);
      rmSync(RAW_DIR, { recursive: true, force: true });
      console.log(`Done: ${path.relative(ROOT, FOOTAGE_DIR)}/ (desktop.mp4, phone.mp4, marks.json)`);
      return;
    }
    console.log("Assembling video…");
    const out = path.join(OUT_DIR, "mizan-demo.mp4");
    assemble([desktop, phone], out);
    rmSync(RAW_DIR, { recursive: true, force: true });
    console.log(`Done: ${path.relative(ROOT, out)} (${duration(out).toFixed(1)} s)`);
  } finally {
    await browser?.close();
    await mock.close();
    vite.kill();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
