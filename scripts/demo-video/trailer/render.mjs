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
// "keynote" (keynote.js + keynote.css + keynote-audio.mjs; bright, calm, product-launch).

import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeWav } from "./audio.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STYLES = {
  trailer: { js: "runtime.js", css: "styles.css", audio: "./audio.mjs" },
  keynote: { js: "keynote.js", css: "keynote.css", audio: "./keynote-audio.mjs" },
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
  return `<!doctype html><html><head><meta charset="utf-8"><style>:root{${vars}}\n${readFileSync(path.join(HERE, style.css), "utf8")}</style></head>
<body><div id="stage"></div><script>${readFileSync(path.join(HERE, style.js), "utf8")}</script></body></html>`;
}

export async function render(configPath) {
  const config = (await import(pathToFileURL(path.resolve(configPath)).href)).default;
  const fps = Number(arg("--fps") || config.fps || 30);
  const style = STYLES[config.style || "trailer"];
  if (!style) throw new Error(`Unknown style "${config.style}" (use ${Object.keys(STYLES).join(" or ")})`);
  const { synthesize } = await import(style.audio);
  const theme = config.style === "keynote" ? { ...config.theme } : { ...DEFAULT_THEME, ...config.theme };
  const { scenes, total } = timeline(config);
  const out = path.resolve(config.out || "recordings/trailer.mp4");
  const cache = path.join(path.dirname(out), ".trailer-cache", path.basename(out, ".mp4"));
  mkdirSync(cache, { recursive: true });

  console.log(`Timeline: ${scenes.length} scenes, ${total.toFixed(1)} s at ${config.bpm} BPM`);
  cutFootage(config, scenes, cache, fps);
  writeFileSync(path.join(cache, "index.html"), pageHtml(theme, style));
  const payload = { brand: config.brand, bpm: config.bpm, fps, total, theme, icon: readIcon(config.icon), scenes };

  const browser = await chromium.launch({ executablePath: findChromium() });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(pathToFileURL(path.join(cache, "index.html")).href);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate((p) => window.trailer.init(p), payload);
    const cdp = await page.context().newCDPSession(page);
    const shot = async (format) => Buffer.from((await cdp.send("Page.captureScreenshot", { format, quality: format === "jpeg" ? 92 : undefined, optimizeForSpeed: true })).data, "base64");

    const stills = arg("--stills");
    if (stills) {
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
      return;
    }

    const [from, to] = (arg("--range") || `0,${total}`).split(",").map(Number);
    console.log("Synthesizing soundtrack…");
    const wav = path.join(cache, "music.wav");
    writeWav(wav, synthesize({ bpm: config.bpm, total, scenes, chords: config.music?.chords, tail: 0 }));

    const frames = Math.round((Math.min(to, total) - from) * fps);
    const target = arg("--range") ? out.replace(/\.mp4$/, `-${from}-${to}.mp4`) : out;
    const enc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
      "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
      "-ss", String(from), "-i", wav, "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", target], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((res, rej) => enc.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))));
    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      await page.evaluate((x) => window.trailer.frame(x), from + i / fps);
      if (!enc.stdin.write(await shot("jpeg"))) await new Promise((r) => enc.stdin.once("drain", r));
      if (i % (fps * 5) === 0) process.stdout.write(`\r  frame ${i}/${frames} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    }
    enc.stdin.end();
    await done;
    process.stdout.write("\n");
    ffmpeg(["-ss", String(config.poster ?? Math.min(total - 0.5, (scenes[0]?.dur ?? 3) * 0.9)), "-i", target, "-frames:v", "1", target.replace(/\.mp4$/, "-poster.png")]);
    console.log(`Done: ${path.relative(process.cwd(), target)} (${(frames / fps).toFixed(1)} s)`);
  } finally {
    await browser.close();
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
