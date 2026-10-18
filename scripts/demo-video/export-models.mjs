#!/usr/bin/env node
// Saves the cinema film's 3D devices as binary glTF (.glb) files in assets/models/:
// a 14" MacBook Pro (space black, silver) and an iPhone 18 Pro (four finishes).
// They are built in headless Chromium from trailer/devices.js and written with three's
// GLTFExporter, so the files always match what the film renders.
//
//   pnpm demo:models            → assets/models/*.glb
//   add --out <dir>             write somewhere else

import { chromium } from "playwright-core";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyThree, findChromium, serve } from "./trailer/render.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.resolve(process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : path.join(ROOT, "assets/models"));

const MODELS = [
  { file: "macbook-pro-14-space-black.glb", kind: "mac", finish: "spaceBlack" },
  { file: "macbook-pro-14-silver.glb", kind: "mac", finish: "silver" },
  { file: "iphone-18-pro-silver.glb", kind: "phone", finish: "silver" },
  { file: "iphone-18-pro-black.glb", kind: "phone", finish: "black" },
  { file: "iphone-18-pro-glacier.glb", kind: "phone", finish: "glacier" },
  { file: "iphone-18-pro-burgundy.glb", kind: "phone", finish: "burgundy" },
];

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script type="importmap">{"imports":{"three":"./three/three.module.js","three/addons/":"./three/addons/"}}</script>
<script type="module">
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { buildMacBookPro, buildIPhone } from "./devices.js";
window.exportModel = async ({ kind, finish }) => {
  await document.fonts.ready;
  const scene = new THREE.Scene();
  if (kind === "mac") {
    const mac = buildMacBookPro({ finish });
    mac.lid.rotation.x = -0.24; // open, about 104 degrees
    scene.add(mac.group);
  } else {
    scene.add(buildIPhone({ finish }).group);
  }
  // glTF units are metres; the builders use 1 unit = 10 cm, and the film shows the phone at 1.12x.
  scene.children[0].scale.setScalar(kind === "mac" ? 0.1 : 0.1 / 1.12);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize: 2048 });
  let s = "";
  const bytes = new Uint8Array(glb);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
window.ready = true;
</script></body></html>`;

const cache = mkdtempSync(path.join(tmpdir(), "mizan-models-"));
copyThree(cache, { modules: ["devices.js"], addons: ["exporters/GLTFExporter.js"] });
writeFileSync(path.join(cache, "index.html"), PAGE);
const server = await serve(cache);
const browser = await chromium.launch({ executablePath: findChromium() });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
  mkdirSync(OUT, { recursive: true });
  for (const m of MODELS) {
    const b64 = await page.evaluate((x) => window.exportModel(x), m);
    const file = path.join(OUT, m.file);
    writeFileSync(file, Buffer.from(b64, "base64"));
    console.log(`${path.relative(ROOT, file)}  ${(statSync(file).size / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
  server.close();
  rmSync(cache, { recursive: true, force: true });
}
