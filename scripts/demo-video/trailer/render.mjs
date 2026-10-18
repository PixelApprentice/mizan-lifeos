#!/usr/bin/env node
// Renders a motion-graphics trailer from a config module.
//
//   node scripts/demo-video/trailer/render.mjs <config.mjs>                full trailer (mp4)
//   node scripts/demo-video/trailer/render.mjs <config.mjs> --stills auto  one still per scene + contact sheet
//   node scripts/demo-video/trailer/render.mjs <config.mjs> --stills 3,12.5
//   node scripts/demo-video/trailer/render.mjs <config.mjs> --range 8,20   render part of the timeline
//
// Pipeline: footage frames are cut with ffmpeg, a headless Chromium page (runtime.js +
// styles.css) draws each frame deterministically, frames are piped into ffmpeg and muxed
// with a soundtrack synthesized by audio.mjs. Needs ffmpeg and playwright-core's Chromium.
//
// config.style picks the look: "trailer" (default; retro, punchy, chiptune-ish) or
// "keynote" (keynote.js + keynote.css + keynote-audio.mjs; bright, calm, product-launch) or
// "cinema" (cinema.js + cinema.css + cinema-audio.mjs; 3D laptop and phone rendered with
// three.js on the GPU, one continuous camera, an arranged score with interface sounds).
//
// --workers N renders the timeline in N parallel browsers (default 3) and joins the parts.

import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeWav } from "./audio.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STYLES = {
  trailer: { js: "runtime.js", css: "styles.css", audio: "./audio.mjs" },
  keynote: { js: "keynote.js", css: "keynote.css", audio: "./keynote-audio.mjs" },
  cinema: { js: "cinema.js", css: "cinema.css", audio: "./cinema-audio.mjs", three: true, modules: ["devices.js"] },
};
const DEFAULT_ENERGY = { logo: 0, words: 1, collapse: 1, montage: 3, footage: 2, phone: 2, counters: 2, outro: 0 };
const DEFAULT_THEME = {
  bg: "#050606", fg: "#f4f4f5", muted: "#a1a1aa", accent: "#6ee7b7", accent2: "#eab308", cell: "#0b1d17",
  font: '"JetBrains Mono", ui-monospace, monospace', display: '"JetBrains Mono", ui-monospace, monospace',
};

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function ffmpeg(args, opts = {}) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit", ...opts });
}

export function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = path.join(homedir(), ".cache/ms-playwright");
  if (!existsSync(cache)) return undefined;
  for (const dir of readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-win/chrome.exe"]) {
      const candidate = path.join(cache, dir, sub);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

// Pixel-art SVG (one <rect> per pixel or run) → data the logo animation can fly in.
function readIcon(file) {
  if (!file || !existsSync(file)) return null;
  const svg = readFileSync(file, "utf8");
  const vb = svg.match(/viewBox="[\d.\s-]+?\s([\d.]+)\s([\d.]+)"/);
  const rects = [...svg.matchAll(/<rect\b([^>]*)\/?>/g)].map(([, attrs]) => {
    const get = (k) => attrs.match(new RegExp(`\\b${k}="([^"]+)"`))?.[1];
    return { x: +(get("x") || 0), y: +(get("y") || 0), w: +(get("width") || 1), h: +(get("height") || 1), fill: get("fill") || "#fff" };
  }).filter((r) => r.fill !== "none");
  return { size: vb ? Math.max(+vb[1], +vb[2]) : 24, rects };
}

function timeline(config) {
  const beat = 60 / config.bpm;
  let t = 0;
  const scenes = config.scenes.map((s, i) => {
    // A montage lasts as long as its cuts unless beats is given.
    const beats = s.beats ?? (s.clips || []).reduce((sum, c) => sum + (c.beats ?? 2), 0);
    if (!beats) throw new Error(`Scene ${i} (${s.type}) needs beats`);
    const out = { ...s, id: `s${String(i).padStart(2, "0")}-${s.type}`, start: +t.toFixed(4), dur: +(beats * beat).toFixed(4), energy: s.energy ?? DEFAULT_ENERGY[s.type] ?? 1 };
    if (s.type === "collapse") {
      // Shared by the visuals and the soundtrack: items pop in over the first half, get
      // struck through, pulled to the centre, and the answer lands.
      const n = s.items.length, D = out.dur;
      out.cue = {
        appear: s.items.map((_, k) => +(0.35 + (k * (D * 0.5 - 0.35)) / Math.max(1, n - 1)).toFixed(3)),
        strike: +(D * 0.6).toFixed(3),
        suck: +(D * 0.7).toFixed(3),
        title: +(D * 0.7 + 0.55).toFixed(3),
      };
    }
    t += out.dur;
    return out;
  });
  return { scenes, total: +t.toFixed(4) };
}

// Cuts each scene's footage into numbered JPEGs (cached by parameters).
function cutFootage(config, scenes, cache, fps) {
  const beat = 60 / config.bpm;
  for (const s of scenes) {
    if (s.clip) s.clip = cutClip(config, s.clip, s.id, s.dur, cache, fps, s.id);
    // Any other footage on the scene (e.g. the keynote phone scene's `desktop` clip).
    for (const [key, v] of Object.entries(s)) {
      if (key !== "clip" && v && typeof v === "object" && !Array.isArray(v) && v.source) s[key] = cutClip(config, v, `${s.id}-${key}`, s.dur, cache, fps, s.id);
    }
    if (s.clips) {
      let start = 0;
      s.clips = s.clips.map((c, k) => {
        const dur = (c.beats ?? 2) * beat;
        const out = { ...cutClip(config, c, `${s.id}-${k}`, dur, cache, fps, s.id), start: +start.toFixed(4), dur: +dur.toFixed(4) };
        start += dur;
        return out;
      });
    }
  }
}

// Cuts one clip into numbered JPEGs under frames/<name>/, cached by its parameters.
function cutClip(config, clip, name, dur, cache, fps, sceneId) {
  const src = config.footage?.[clip.source];
  if (!src) throw new Error(`Scene ${sceneId}: unknown footage source "${clip.source}"`);
  const file = path.resolve(src.file);
  if (!existsSync(file)) throw new Error(`Footage not found: ${file}`);
  const speed = clip.speed ?? 1;
  const pre = Math.min(0.6, clip.from / speed);
  const dir = path.join(cache, "frames", name);
  const key = JSON.stringify({ file, mtime: statSync(file).mtimeMs, from: clip.from, speed, dur, crop: src.crop, fps, pre });
  const keyFile = path.join(dir, "key.json");
  if (!(existsSync(keyFile) && readFileSync(keyFile, "utf8") === key)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const filters = [];
    if (src.crop) filters.push(`crop=${src.crop.join(":")}`);
    filters.push(`setpts=(PTS-STARTPTS)/${speed}`, `fps=${fps}`);
    ffmpeg(["-ss", (clip.from - pre * speed).toFixed(3), "-t", ((dur + pre + 0.6) * speed).toFixed(3), "-i", file, "-vf", filters.join(","), "-q:v", "2", path.join(dir, "%05d.jpg")]);
    writeFileSync(keyFile, key);
  }
  return { ...clip, dir: name, pre, frames: readdirSync(dir).filter((f) => f.endsWith(".jpg")).length };
}

function pageHtml(theme, style) {
  const vars = Object.entries(theme).filter(([, v]) => typeof v === "string").map(([k, v]) => `--${k}:${v}`).join(";");
  const js = readFileSync(path.join(HERE, style.js), "utf8");
  const script = style.three
    ? `<script type="importmap">{"imports":{"three":"./three/three.module.js","three/addons/":"./three/addons/"}}</script><script type="module">${js}</script>`
    : `<script>${js}</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>:root{${vars}}\n${readFileSync(path.join(HERE, style.css), "utf8")}</style></head>
<body><div id="stage"></div>${script}</body></html>`;
}

// three.js is loaded from the project's node_modules into the page cache, so the
// page works offline and the version is the one in the lockfile.
// Copies three.js (plus the addons the runtimes use) and the style's own modules into the cache.
export function copyThree(cache, { modules = [], addons = [] } = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.resolve("three"))), "..");
  const files = ["build/three.module.js", "build/three.core.js", "examples/jsm/geometries/RoundedBoxGeometry.js",
    "examples/jsm/environments/RoomEnvironment.js", "examples/jsm/objects/Reflector.js", ...addons.map((a) => `examples/jsm/${a}`)];
  for (const f of files) {
    const dest = path.join(cache, "three", f.startsWith("build/") ? path.basename(f) : f.replace("examples/jsm/", "addons/"));
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(root, f), dest);
  }
  for (const m of modules) copyFileSync(path.join(HERE, m), path.join(cache, m));
}

// ES modules need http(s); file:// pages can't import. Serves the cache dir on localhost.
export async function serve(dir) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json" };
  const server = http.createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// Puts a sound on every click, keystroke and drag recorded with the footage: each event
// is mapped through the clip that shows it (from, speed) onto the film's timeline.
function foleyCues(config, scenes) {
  const cues = [];
  for (const s of scenes) {
    const clips = Object.entries(s).filter(([k, v]) => v && typeof v === "object" && !Array.isArray(v) && v.source && k !== "cam");
    for (const [key, c] of clips) {
      const events = config.footage?.[c.source]?.events;
      if (!events || c.foley === false) continue;
      const speed = c.speed ?? 1;
      for (const e of events) {
        const t = s.start + (e.t - c.from) / speed;
        if (t >= s.start + 0.15 && t < s.start + s.dur - 0.1) cues.push({ t: +t.toFixed(3), kind: e.kind, pan: key === "phone" ? 0.45 : -0.1, gain: c.foley ?? 1 });
      }
    }
  }
  return cues.sort((a, b) => a.t - b.t);
}

async function openPage(browser, url, payload) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("page console:", m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.trailer, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((p) => window.trailer.init(p), payload);
  const cdp = await page.context().newCDPSession(page);
  const shot = async (format) => Buffer.from((await cdp.send("Page.captureScreenshot", { format, quality: format === "jpeg" ? 95 : undefined, optimizeForSpeed: true })).data, "base64");
  return { page, shot };
}

// Screenshots are full-range BT.601 JPEGs; the film is tagged and converted to
// limited-range BT.709 so players don't shift the colours.
const COLOR = ["-vf", "scale=in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

async function renderSegment({ launch, url, payload, fps, first, count, file, label, progress }) {
  const browser = await chromium.launch(launch);
  try {
    const { page, shot } = await openPage(browser, url, payload);
    const enc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
      "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
      ...COLOR, "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-tune", "film", file], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((res, rej) => enc.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code} (${label})`)))));
    for (let i = 0; i < count; i++) {
      await page.evaluate((x) => window.trailer.frame(x), (first + i) / fps);
      if (!enc.stdin.write(await shot("jpeg"))) await new Promise((r) => enc.stdin.once("drain", r));
      progress(label, i + 1);
    }
    enc.stdin.end();
    await done;
  } finally {
    await browser.close();
  }
}

export async function render(configPath) {
  const config = (await import(pathToFileURL(path.resolve(configPath)).href)).default;
  const fps = Number(arg("--fps") || config.fps || 30);
  const style = STYLES[config.style || "trailer"];
  if (!style) throw new Error(`Unknown style "${config.style}" (use ${Object.keys(STYLES).join(" or ")})`);
  const { synthesize } = await import(style.audio);
  const theme = config.style === "trailer" || !config.style ? { ...DEFAULT_THEME, ...config.theme } : { ...config.theme };
  const { scenes, total } = timeline(config);
  const out = path.resolve(config.out || "recordings/trailer.mp4");
  const cache = path.join(path.dirname(out), ".trailer-cache", path.basename(out, ".mp4"));
  mkdirSync(cache, { recursive: true });

  console.log(`Timeline: ${scenes.length} scenes, ${total.toFixed(1)} s at ${config.bpm} BPM`);
  const foley = foleyCues(config, scenes);
  cutFootage(config, scenes, cache, fps);
  writeFileSync(path.join(cache, "index.html"), pageHtml(theme, style));
  if (style.three) copyThree(cache, { modules: style.modules });
  const payload = { brand: config.brand, bpm: config.bpm, fps, total, theme, icon: readIcon(config.icon), scenes, world: config.world };

  // WebGL styles want the real GPU; headless Chromium otherwise falls back to SwiftShader.
  const launch = { executablePath: findChromium(), args: style.three ? ["--use-angle=" + (process.env.TRAILER_ANGLE || "gl"), "--ignore-gpu-blocklist", "--enable-gpu"] : [] };
  const server = await serve(cache);
  const url = `${server.url}/index.html`;
  try {
    const stills = arg("--stills");
    if (stills) {
      const browser = await chromium.launch(launch);
      try {
        const { page, shot } = await openPage(browser, url, payload);
        if (style.three) console.log("GPU:", await page.evaluate(() => window.trailer.gpu?.()));
        const times = stills === "auto" ? scenes.map((s) => +(s.start + s.dur * 0.62).toFixed(2)) : stills.split(",").map(Number);
        const dir = path.join(path.dirname(out), `${path.basename(out, ".mp4")}-stills`);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        const files = [];
        for (const t of times) {
          await page.evaluate((x) => window.trailer.frame(x), t);
          const f = path.join(dir, `t${t.toFixed(2).padStart(6, "0")}.png`);
          writeFileSync(f, await shot("png"));
          files.push(f);
        }
        const cols = Math.min(4, files.length), rows = Math.ceil(files.length / cols);
        ffmpeg(["-framerate", "1", "-pattern_type", "glob", "-i", path.join(dir, "t*.png"),
          "-vf", `scale=640:-1,tile=${cols}x${rows}:padding=6:color=0x222222`, "-frames:v", "1", path.join(dir, "sheet.png")]);
        console.log(`Stills: ${path.relative(process.cwd(), dir)}/ (${files.length} + sheet.png)`);
      } finally {
        await browser.close();
      }
      return;
    }

    const [from, to] = (arg("--range") || `0,${total}`).split(",").map(Number);
    console.log(`Synthesizing soundtrack… (${foley.length} interface sounds)`);
    const wav = path.join(cache, "music.wav");
    writeWav(wav, synthesize({ bpm: config.bpm, total, scenes, chords: config.music?.chords, tail: 0, foley }));

    const frames = Math.round((Math.min(to, total) - from) * fps);
    const first = Math.round(from * fps);
    const workers = Math.max(1, Math.min(Number(arg("--workers") || config.workers || 3), Math.ceil(frames / fps)));
    const target = arg("--range") ? out.replace(/\.mp4$/, `-${from}-${to}.mp4`) : out;
    const segDir = path.join(cache, "segments");
    rmSync(segDir, { recursive: true, force: true });
    mkdirSync(segDir, { recursive: true });
    const started = Date.now(), done = {};
    const progress = (label, n) => {
      done[label] = n;
      const sum = Object.values(done).reduce((a, b) => a + b, 0);
      if (sum % fps === 0 || sum === frames) {
        const el = (Date.now() - started) / 1000;
        process.stdout.write(`\r  frame ${sum}/${frames} · ${el.toFixed(0)} s · ~${((el / sum) * (frames - sum)).toFixed(0)} s left   `);
      }
    };
    const per = Math.ceil(frames / workers), segs = [];
    for (let w = 0; w < workers; w++) {
      const a = w * per, count = Math.min(per, frames - a);
      if (count > 0) segs.push({ first: first + a, count, file: path.join(segDir, `seg${w}.mp4`), label: `w${w}` });
    }
    console.log(`Rendering ${frames} frames with ${segs.length} worker${segs.length > 1 ? "s" : ""}…`);
    await Promise.all(segs.map((sg) => renderSegment({ launch, url, payload, fps, progress, ...sg })));
    process.stdout.write("\n");
    writeFileSync(path.join(segDir, "list.txt"), segs.map((sg) => `file '${sg.file}'`).join("\n"));
    ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(segDir, "list.txt"), "-ss", String(from), "-i", wav,
      "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", target]);
    ffmpeg(["-ss", String(config.poster ?? Math.min(total - 0.5, (scenes[0]?.dur ?? 3) * 0.9)), "-i", target, "-frames:v", "1", target.replace(/\.mp4$/, "-poster.png")]);
    console.log(`Done: ${path.relative(process.cwd(), target)} (${(frames / fps).toFixed(1)} s, ${((Date.now() - started) / 1000).toFixed(0)} s to render)`);
  } finally {
    server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = process.argv[2];
  if (!config || config.startsWith("--")) {
    console.error("usage: render.mjs <config.mjs> [--stills auto|t1,t2] [--range from,to] [--fps 30]");
    process.exit(2);
  }
  render(config).catch((e) => { console.error(e); process.exit(1); });
}
