// Cinema style runtime: a 14" MacBook Pro and an iPhone 18 Pro in a dark studio, rendered
// with three.js, filmed by one continuous camera, with big quiet type on top.
// world.mac: "spaceBlack" | "silver"; world.iphone: "silver" | "black" | "glacier" | "burgundy".
// Laptop footage should be recorded at 1512x945 CSS px (the screen below the notch band).
// The renderer calls `trailer.init(config)` once, then `await trailer.frame(t)` per frame.
// Everything is a pure function of t, so any frame can be rendered on its own.
//
// Scene types: title, shot, list, grid, end. Every scene can also drive the 3D world:
//   cam:    [{ at, on: "laptop"|"phone"|"point", focus: [u, v], point: [x, y, z], dist, yaw, pitch,
//              roll, fov, shift: [x, y], ease }]  (at = seconds into the scene; values carry over)
//   world:  { exposure, blur, dim, bars }  eased in over `fly` seconds
//   lid:    [[at, open 0..1], …]
//   screen: footage clip on the laptop, or screenShow: "logo" | "off"
//   phone:  footage clip on the phone (the phone rises into view while scenes have one)
//   flash:  true = a soft flash of light as the scene starts (pairs with a drop in the music)
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { buildMacBookPro, buildIPhone } from "./devices.js";

const W = 1920, H = 1080;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const prog = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const lerp = (a, b, k) => a + (b - a) * k;
const E = {
  linear: (x) => x,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inCubic: (x) => x ** 3,
  outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  inOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  outBack: (x) => 1 + 1.4 * (x - 1) ** 3 + 0.4 * (x - 1) ** 2,
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}
// Smooth deterministic wobble for a hand-held feel.
const wob = (t, s) => Math.sin(t * 0.9 + s) * 0.6 + Math.sin(t * 1.7 + s * 2.3) * 0.3 + Math.sin(t * 3.1 + s * 0.7) * 0.1;

const ctx = { fps: 30 };
const XF = 0.6; // type crossfade, seconds

// ---------- typography (same grammar as the keynote style) ----------

function headline(parent, lines, size = "l", firstAt = 0.25) {
  const box = el("div", `h ${size}`, parent);
  const words = [];
  let at = firstAt;
  for (const raw of lines || []) {
    const line = typeof raw === "string" ? { t: raw } : raw;
    if (line.at != null) at = line.at;
    const grad = line.tone === "grad";
    const row = el("span", `line ${grad ? "" : line.tone || ""}`, box);
    line.t.split(/(?<=\s)/).forEach((w, k) => words.push({ e: el("span", grad ? "w grad" : "w", row, esc(w)), row: grad ? row : null, at: at + k * 0.07 }));
    at += 0.07 * line.t.split(/\s+/).length + 0.18;
  }
  let laid = false;
  const update = (lt) => {
    if (!laid) {
      laid = true;
      for (const w of words) if (w.row) {
        w.e.style.backgroundSize = `${w.row.offsetWidth}px 100%`;
        w.e.style.backgroundPosition = `${-(w.e.offsetLeft - w.row.offsetLeft)}px 0`;
      }
    }
    for (const w of words) {
      const p = prog(lt, w.at, w.at + 0.8);
      w.e.style.opacity = E.outCubic(p);
      w.e.style.transform = `translateY(${(1 - E.outExpo(p)) * 54}px) scale(${1 + (1 - E.outExpo(p)) * 0.06})`;
      w.e.style.filter = p < 1 ? `blur(${(1 - p) * 16}px)` : "none";
    }
  };
  return { box, update, end: at, starts: [...new Set(words.map((w) => w.at))] };
}

function rise(e, lt, at, dist = 30, dur = 0.9) {
  const p = prog(lt, at, at + dur);
  e.style.opacity = E.outCubic(p);
  e.style.transform = `translateY(${(1 - E.outExpo(p)) * dist}px)`;
  e.style.filter = p < 1 ? `blur(${(1 - p) * 10}px)` : "none";
}

function iconSvg() {
  const ic = ctx.icon;
  if (!ic) return "";
  return `<svg viewBox="0 0 ${ic.size} ${ic.size}" xmlns="http://www.w3.org/2000/svg">${ic.rects.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.fill}"/>`).join("")}</svg>`;
}

function copyBlock(wrap, s) {
  if (!s.lines && !s.kicker) return () => {};
  const side = s.side || "left";
  el("div", `scrim ${side}`, wrap);
  const box = el("div", `copy ${side}`, wrap);
  const k = s.kicker ? el("div", "kicker", box, esc(s.kicker)) : null;
  const h = headline(box, s.lines, s.size || "m", (s.copyAt ?? 0.35) + (k ? 0.12 : 0));
  const body = s.body ? el("div", "body", box, s.body) : null;
  return (lt) => {
    if (k) rise(k, lt, s.copyAt ?? 0.35, 18);
    h.update(lt);
    if (body) rise(body, lt, h.end + 0.1, 24);
  };
}

const SCENES = {
  title(wrap, s) {
    const c = el("div", "center", wrap);
    const h = headline(c, s.lines, s.size || "xl", s.at ?? 0.3);
    return (lt) => {
      h.update(lt);
      c.style.transform = `scale(${1 + 0.04 * prog(lt, 0, s.dur)})`;
    };
  },

  shot(wrap, s) {
    const copy = copyBlock(wrap, s);
    const cap = s.caption ? el("div", "caption", wrap, esc(s.caption)) : null;
    return (lt) => {
      copy(lt);
      if (cap) rise(cap, lt, s.captionAt ?? 1.2, 20, 1.0);
    };
  },

  list(wrap, s) {
    const c = el("div", "center", wrap);
    const step = s.step ?? 0.7;
    const rows = (s.items || []).map((t, i) => ({ e: el("div", "h l line", c, esc(t)), at: 0.3 + i * step }));
    const fin = s.final ? el("div", `h l line ${s.finalTone || "grad"}`, c, esc(s.final)) : null;
    if (fin) fin.style.marginTop = "34px";
    const finAt = 0.3 + rows.length * step + 0.25;
    return (lt) => {
      rows.forEach((r, i) => {
        rise(r.e, lt, r.at, 50, 0.8);
        const next = rows[i + 1]?.at ?? (fin ? finAt : Infinity);
        r.e.style.opacity = E.outCubic(prog(lt, r.at, r.at + 0.8)) * lerp(1, 0.25, E.outCubic(prog(lt, next, next + 0.6)));
      });
      if (fin) rise(fin, lt, finAt, 50, 1.0);
    };
  },

  grid(wrap, s) {
    const title = el("div", "grid-title", wrap);
    const h = headline(title, s.lines, s.size || "m", 0.2);
    const g = el("div", "tiles", wrap);
    g.style.gridTemplateColumns = `repeat(${s.cols || 4}, 1fr)`;
    const tiles = (s.tiles || []).map((t, i) => {
      const e = el("div", "tile", g, `<div class="big ${t.grad ? "grad" : ""}">${esc(t.big)}</div><div class="label">${esc(t.label || "")}</div>`);
      if (t.span) e.style.gridColumn = `span ${t.span}`;
      if (t.rows) e.style.gridRow = `span ${t.rows}`;
      return { e, at: 0.6 + i * 0.11 };
    });
    return (lt) => {
      h.update(lt);
      for (const t of tiles) {
        const p = prog(lt, t.at, t.at + 1.0);
        t.e.style.opacity = E.outCubic(p);
        t.e.style.transform = `perspective(1400px) translateY(${(1 - E.outExpo(p)) * 90}px) rotateX(${(1 - E.outExpo(p)) * 18}deg) scale(${0.94 + 0.06 * E.outCubic(p)})`;
      }
      g.style.transform = `scale(${1 + 0.02 * prog(lt, 1, s.dur)})`;
    };
  },

  end(wrap, s) {
    const c = el("div", "center", wrap);
    c.style.justifyContent = "flex-start";
    c.style.paddingTop = `${s.top ?? 150}px`;
    const icon = el("div", "appicon", c, iconSvg());
    const word = el("div", "wordmark", c, esc(s.title || "Mizan"));
    const tag = el("div", "tagline", c, esc(s.tagline || ""));
    const fine = s.fine ? el("div", "fine", c, esc(s.fine)) : null;
    const pill = s.cta ? el("div", "pill", c, esc(s.cta)) : null;
    return (lt) => {
      const p = prog(lt, 0.2, 1.3);
      icon.style.opacity = E.outCubic(p);
      icon.style.transform = `scale(${0.55 + 0.45 * E.outBack(p)}) translateY(${(1 - E.outExpo(p)) * 50}px)`;
      icon.style.filter = p < 1 ? `blur(${(1 - p) * 16}px)` : "none";
      rise(word, lt, 0.6, 40);
      rise(tag, lt, 1.1, 24);
      if (fine) rise(fine, lt, 1.5, 18);
      if (pill) rise(pill, lt, 1.9, 24);
    };
  },
};

// ---------- the 3D studio ----------

const world = {};

// Screen shader: two footage textures crossfaded, cover-cropped (keeping the top of the
// picture), rounded corners (separate top and bottom radius), an optional black band at the
// top (the MacBook Pro menu-bar strip that holds the camera notch) and a light sweep.
function displayMaterial(planeAspect, radiusTop, radiusBottom = radiusTop) {
  return new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: {
      tA: { value: null }, tB: { value: null }, mixAB: { value: 0 }, bright: { value: 0 }, sweep: { value: -2 },
      planeAspect: { value: planeAspect }, aAspect: { value: 16 / 9 }, bAspect: { value: 16 / 9 },
      radiusT: { value: radiusTop }, radiusB: { value: radiusBottom }, insetA: { value: 0 }, insetB: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tA, tB; uniform float mixAB, bright, sweep, planeAspect, aAspect, bAspect, radiusT, radiusB, insetA, insetB;
      varying vec2 vUv;
      vec3 sampleFit(sampler2D t, float ta, float inset) {
        if (vUv.y > 1.0 - inset) return vec3(0.0);
        vec2 uv = vec2(vUv.x, vUv.y / (1.0 - inset));
        float pa = planeAspect / (1.0 - inset);
        if (ta > pa) uv.x = 0.5 + (uv.x - 0.5) * pa / ta;
        else uv.y = 1.0 - (1.0 - uv.y) * ta / pa;
        return texture2D(t, uv).rgb;
      }
      void main() {
        vec2 p = (vUv - 0.5) * vec2(planeAspect, 1.0);
        float r = p.y > 0.0 ? radiusT : radiusB;
        vec2 b = vec2(planeAspect, 1.0) * 0.5 - r;
        if (length(max(abs(p) - b, 0.0)) - r > 0.0) discard;
        vec3 col = mix(sampleFit(tA, aAspect, insetA), sampleFit(tB, bAspect, insetB), mixAB);
        float band = exp(-pow((vUv.x * 0.8 + (1.0 - vUv.y) * 0.5 - sweep) * 5.0, 2.0));
        col = col * bright + band * 0.08 * bright;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

async function logoTexture(brand) {
  await document.fonts.load('800 200px "Adwaita Sans"').catch(() => {});
  const c = document.createElement("canvas");
  c.width = 1512; c.height = 982;
  const g = c.getContext("2d");
  g.fillStyle = "#1a1b1d"; g.fillRect(0, 0, c.width, c.height);
  const ic = ctx.icon;
  if (ic) {
    const s = 260 / ic.size, x0 = 756 - 130, y0 = 250;
    for (const r of ic.rects) { g.fillStyle = r.fill; g.fillRect(x0 + r.x * s, y0 + r.y * s, r.w * s + 0.5, r.h * s + 0.5); }
  }
  g.fillStyle = "#f5f5f7"; g.textAlign = "center";
  g.font = '700 132px "Adwaita Sans", sans-serif';
  g.fillText(brand || "Mizan", 756, 690);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function blackTexture() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

function radialTexture(stops) {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  for (const [o, col] of stops) r.addColorStop(o, col);
  g.fillStyle = r; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

async function buildWorld(cfg) {
  const stage = document.getElementById("stage");
  const canvas = el("canvas", "", stage);
  canvas.id = "gl";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const bg = new THREE.Color(cfg.world?.bg || "#050607");
  const scene = new THREE.Scene();
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 9, 26);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;

  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-4.5, 8, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6; key.shadow.camera.right = 6; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 1; key.shadow.camera.far = 25;
  key.shadow.radius = 4;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xeef3ff, 2.6);
  rim.position.set(4, 5, -7);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xfff4e8, 1.6);
  rim2.position.set(-6, 3, -5);
  scene.add(rim2);

  // Polished black floor: a mirror under a dark glaze, plus the devices' soft shadows.
  const mirror = new Reflector(new THREE.PlaneGeometry(60, 60), { textureWidth: 1920, textureHeight: 1080, color: 0x8a8f96, clipBias: 0.002 });
  mirror.rotation.x = -Math.PI / 2;
  scene.add(mirror);
  const glaze = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: bg, transparent: true, opacity: 0.8, depthWrite: false }));
  glaze.rotation.x = -Math.PI / 2;
  glaze.position.y = 0.002;
  scene.add(glaze);
  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.55, depthWrite: false }));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = 0.004;
  shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);
  // A pool of light under the products.
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(14, 9), new THREE.MeshBasicMaterial({
    map: radialTexture([[0, "rgba(255,255,255,0.10)"], [0.5, "rgba(255,255,255,0.035)"], [1, "rgba(0,0,0,0)"]]),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0.6, 0.006, 0.2);
  scene.add(pool);

  const mac = buildMacBookPro({ finish: cfg.world?.mac, screen: displayMaterial });
  const { group: laptop, lid, display: laptopDisplay, SW, SH, MENU } = mac;
  scene.add(laptop);
  const iphone = buildIPhone({ finish: cfg.world?.iphone, screen: displayMaterial });
  const { group: phone, display: phoneDisplay, DW, DH } = iphone;
  scene.add(phone);

  const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 80);

  Object.assign(world, {
    renderer, scene, camera, laptop, lid, laptopDisplay, phone, phoneDisplay, key, maxAniso, SW, SH, DW, DH, menu: MENU,
    black: blackTexture(), logo: await logoTexture(cfg.brand),
  });

  // Overlays on top of the picture.
  el("div", "vignette", stage);
  world.layer = el("div", "", stage);
  world.flash = el("div", "flash", stage);
  world.grain = el("div", "grain", stage);
  world.grains = makeGrain(6);
  world.bars = [el("div", "bars top", stage), el("div", "bars bottom", stage)];
  world.fade = el("div", "black", stage);
}

function makeGrain(n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const img = g.createImageData(256, 256);
    let s = 1234567 + k * 7919;
    for (let i = 0; i < img.data.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const v = 128 + ((s >> 8) % 255) - 127;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    out.push(`url(${c.toDataURL()})`);
  }
  return out;
}

// ---------- footage on the screens ----------

const clipTex = new Map();
function clipFrame(clip, lt) {
  let e = clipTex.get(clip);
  if (!e) {
    const tex = new THREE.Texture();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = world.maxAniso;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    e = { tex, img: null, src: null, aspect: 16 / 9 };
    clipTex.set(clip, e);
  }
  const idx = clamp(Math.round((lt + clip.pre) * ctx.fps), 0, clip.frames - 1);
  const src = `frames/${clip.dir}/${String(idx + 1).padStart(5, "0")}.jpg`;
  if (e.src === src) return { entry: e, wait: null };
  e.src = src;
  const img = new Image();
  img.src = src;
  const wait = img.decode().then(() => {
    e.tex.image = img;
    e.aspect = img.naturalWidth / img.naturalHeight;
    e.tex.needsUpdate = true;
  }).catch(() => {});
  return { entry: e, wait };
}

// What a display shows for scene s at local time lt: { tex, aspect, wait }.
function screenSource(s, which, lt) {
  const clip = which === "laptop" ? s.screen : s.phone;
  if (clip) {
    const { entry, wait } = clipFrame(clip, lt);
    return { tex: entry.tex, aspect: () => entry.aspect, wait, inset: which === "laptop" ? world.menu : 0 };
  }
  if (which === "laptop" && s.screenShow === "logo") return { tex: world.logo, aspect: () => 1512 / 982, inset: 0 };
  // The phone sinks away during the next scene; keep its last frame up instead of a black screen.
  const prev = cfg.scenes[cfg.scenes.indexOf(s) - 1];
  if (which === "phone" && prev?.phone && lt < 2.5) {
    const { entry, wait } = clipFrame(prev.phone, prev.dur);
    return { tex: entry.tex, aspect: () => entry.aspect, wait, inset: 0 };
  }
  return { tex: world.black, aspect: () => 16 / 9, off: true };
}

// ---------- timeline tracks ----------

let cfg, scenes, camKeys, worldKeys, lidKeys;
const WORLD0 = { exposure: 1, blur: 0, dim: 0, bars: 0 };
const CAM0 = { on: "point", point: [0, 0.6, 0], focus: [0.5, 0.5], dist: 6, yaw: 0, pitch: 12, roll: 0, fov: 30, shift: [0, 0] };

function buildTracks() {
  camKeys = [];
  let last = { ...CAM0 };
  cfg.scenes.forEach((s, i) => {
    (s.cam || []).forEach((k, j) => {
      let at = k.at === "end" ? s.dur : k.at ?? 0;
      if (j === 0 && at === 0 && i > 0) at = Math.min(s.fly ?? 1.1, s.dur * 0.5);
      last = { ...last, ...k, at: s.start + at, ease: k.ease || (j === 0 && i > 0 ? "inOutQuint" : "inOutSine") };
      camKeys.push(last);
    });
  });
  if (!camKeys.length) camKeys.push({ ...CAM0, at: 0 });

  worldKeys = [{ at: 0, ...WORLD0, ...(cfg.scenes[0]?.world || {}) }];
  let cur = worldKeys[0];
  cfg.scenes.forEach((s, i) => {
    if (!i || !s.world) return;
    worldKeys.push({ ...cur, at: s.start });
    cur = { ...cur, ...s.world, at: s.start + (s.worldIn ?? s.fly ?? 1.0) };
    worldKeys.push(cur);
  });

  lidKeys = [];
  for (const s of cfg.scenes) for (const [at, v] of s.lid || []) lidKeys.push({ at: s.start + at, v });
  if (!lidKeys.length) lidKeys.push({ at: 0, v: 1 });
}

function track(keys, t) {
  if (t <= keys[0].at) return { a: keys[0], b: keys[0], k: 0 };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t < b.at) return { a, b, k: (E[b.ease] || E.inOutSine)(prog(t, a.at, b.at)) };
  }
  const z = keys[keys.length - 1];
  return { a: z, b: z, k: 0 };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function anchor(k) {
  if (k.on === "laptop") {
    const [u, v] = k.focus;
    const p = world.laptopDisplay.localToWorld(V((u - 0.5) * world.SW, (0.5 - v) * world.SH, 0));
    return { p, h: 0 };
  }
  if (k.on === "phone") {
    const [u, v] = k.focus;
    const p = world.phoneDisplay.localToWorld(V((u - 0.5) * world.DW, (0.5 - v) * world.DH, 0));
    return { p, h: world.phone.rotation.y };
  }
  return { p: V(...k.point), h: 0 };
}

function placeCamera(t) {
  const { a, b, k } = track(camKeys, t);
  const A = anchor(a), B = anchor(b);
  const p = A.p.lerp(B.p, k);
  const heading = lerp(A.h + (a.yaw * Math.PI) / 180, B.h + (b.yaw * Math.PI) / 180, k);
  const pitch = (lerp(a.pitch, b.pitch, k) * Math.PI) / 180;
  const dist = lerp(a.dist, b.dist, k);
  const cam = world.camera;
  cam.fov = lerp(a.fov, b.fov, k);
  const hand = cfg.world?.handheld ?? 1;
  const dir = V(Math.cos(pitch) * Math.sin(heading), Math.sin(pitch), Math.cos(pitch) * Math.cos(heading));
  cam.position.copy(p).addScaledVector(dir, dist);
  cam.position.x += wob(t, 1) * 0.006 * hand * dist;
  cam.position.y += wob(t, 2) * 0.004 * hand * dist;
  cam.lookAt(p);
  cam.rotateZ(((lerp(a.roll, b.roll, k) + wob(t, 3) * 0.12 * hand) * Math.PI) / 180);
  // Lens shift: moves the subject in the frame without turning the camera.
  const sx = lerp(a.shift[0], b.shift[0], k), sy = lerp(a.shift[1], b.shift[1], k);
  cam.setViewOffset(W, H, -sx * W, -sy * H, W, H);
  cam.updateProjectionMatrix();
}

// Phone rises through the floor while scenes have phone footage, and sinks when they stop.
function phonePose(t) {
  let vis = 0;
  for (let i = 0; i < cfg.scenes.length; i++) {
    const s = cfg.scenes[i];
    if (!s.phone) continue;
    const prevHas = !!cfg.scenes[i - 1]?.phone, nextHas = !!cfg.scenes[i + 1]?.phone;
    const inA = prevHas ? -1 : s.start + (s.phoneAt ?? 0.2), outA = nextHas ? Infinity : s.start + s.dur + 0.2;
    if (t >= inA - 0.01 && t < outA + 1.2) vis = Math.max(vis, Math.min(prevHas ? 1 : E.outCubic(prog(t, inA, inA + 1.6)), nextHas ? 1 : 1 - E.inCubic(prog(t, outA, outA + 1.0))));
  }
  const ph = world.phone;
  const pos = cfg.world?.phone || [2.35, 1.02, 0.45];
  ph.visible = vis > 0.001;
  ph.position.set(pos[0], lerp(-1.4, pos[1], vis) + Math.sin(t * 1.1) * 0.012, pos[2]);
  ph.rotation.set(-0.1, lerp(-0.9, cfg.world?.phoneYaw ?? -0.32, vis), lerp(0.25, 0, vis));
}

function sceneAt(t) {
  return cfg.scenes.find((s) => t >= s.start && t < s.start + s.dur) || cfg.scenes[cfg.scenes.length - 1];
}

function setDisplay(mesh, which, t) {
  const cur = sceneAt(t), i = cfg.scenes.indexOf(cur), prev = cfg.scenes[i - 1];
  const lt = t - cur.start;
  const B = screenSource(cur, which, lt);
  const xf = cur.screenXf ?? 0.45;
  const waits = [B.wait];
  let A = B, mix = 1;
  if (prev && lt < xf) {
    A = screenSource(prev, which, Math.min(t - prev.start, prev.dur + 1));
    mix = E.inOutSine(lt / xf);
    waits.push(A.wait);
  }
  const u = mesh.material.uniforms;
  u.tA.value = A.tex; u.tB.value = B.tex; u.mixAB.value = mix;
  u.insetA.value = A.inset ?? 0; u.insetB.value = B.inset ?? 0;
  // Aspect ratios are known once the frames have decoded.
  mesh.userData.aspects = () => { u.aAspect.value = A.aspect(); u.bAspect.value = B.aspect(); };
  // Boot: the screen glows up as the lid opens.
  const on = which === "laptop" ? (B.off && A.off ? 0 : 1) * E.inOutSine(prog(world.lidOpen, 0.55, 0.95)) : 1;
  u.bright.value = on * (cfg.world?.screenGain ?? 1);
  u.sweep.value = lerp(-0.6, 2.2, prog(lt, 0.15, 1.9));
  return waits.filter(Boolean);
}

// ---------- init / frame ----------

let gpuInfo = "";

async function init(config) {
  cfg = config;
  ctx.fps = cfg.fps;
  ctx.icon = cfg.icon;
  await buildWorld(cfg);
  const gl = world.renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  gpuInfo = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  buildTracks();
  scenes = cfg.scenes.map((s, i) => {
    const wrap = el("div", `scene s-${s.type}`, world.layer);
    const update = SCENES[s.type](wrap, s);
    const next = cfg.scenes[i + 1];
    return { s, wrap, update, pre: i ? XF : 0, post: next ? XF : 0 };
  });
}

async function frame(t) {
  // World look.
  const { a, b, k } = track(worldKeys, t);
  const wv = (key) => lerp(a[key] ?? WORLD0[key], b[key] ?? WORLD0[key], k);
  world.renderer.toneMappingExposure = wv("exposure");
  const blur = wv("blur"), dim = wv("dim");
  world.renderer.domElement.style.filter = blur > 0.2 || dim > 0.01 ? `blur(${blur}px) brightness(${1 - dim})` : "none";
  const bars = wv("bars") * 120;
  for (const e of world.bars) e.style.height = `${bars}px`;

  // Flash on scenes that land on a drop.
  let flash = 0;
  for (const s of cfg.scenes) if (s.flash && t >= s.start - 0.08) flash = Math.max(flash, prog(t, s.start - 0.08, s.start) * (1 - E.outCubic(prog(t, s.start, s.start + 0.8))));
  world.flash.style.opacity = flash * 0.75;
  const last = cfg.scenes[cfg.scenes.length - 1];
  world.fade.style.opacity = E.inOutCubic(prog(t, last.start + last.dur - 1.3, last.start + last.dur - 0.1)) + (1 - E.outCubic(prog(t, 0, 0.8)));

  // Grain: a new pattern every frame, deterministic.
  const fi = Math.round(t * ctx.fps);
  world.grain.style.backgroundImage = world.grains[fi % world.grains.length];
  world.grain.style.backgroundPosition = `${(fi * 73) % 256}px ${(fi * 151) % 256}px`;

  // Devices.
  const { a: la, b: lb, k: lk } = track(lidKeys.map((x) => ({ ...x, ease: "inOutCubic" })), t);
  world.lidOpen = lerp(la.v, lb.v, lk);
  world.lid.rotation.x = lerp(Math.PI / 2, -0.24, world.lidOpen);
  phonePose(t);
  world.scene.updateMatrixWorld(true);
  placeCamera(t);

  const waits = [...setDisplay(world.laptopDisplay, "laptop", t), ...(world.phone.visible ? setDisplay(world.phoneDisplay, "phone", t) : [])];

  // Type.
  for (const sc of scenes) {
    const { s } = sc;
    const on = t >= s.start - sc.pre && t < s.start + s.dur + sc.post;
    sc.wrap.style.display = on ? "block" : "none";
    if (!on) continue;
    const lt = t - s.start;
    let opacity = 1, scale = 1, bl = 0, y = 0;
    if (sc.post && lt > s.dur - sc.post * 0.4) {
      const kk = E.inOutCubic(prog(lt, s.dur - sc.post * 0.4, s.dur + sc.post * 0.6));
      opacity = 1 - kk; scale = 1 + 0.03 * kk; bl = 12 * kk; y = -24 * kk;
    }
    sc.wrap.style.opacity = opacity;
    sc.wrap.style.transform = `translateY(${y}px) scale(${scale})`;
    sc.wrap.style.filter = bl > 0.2 ? `blur(${bl}px)` : "none";
    sc.update(lt);
  }

  await Promise.all(waits);
  world.laptopDisplay.userData.aspects();
  if (world.phone.visible) world.phoneDisplay.userData.aspects();
  world.renderer.render(world.scene, world.camera);
}

window.trailer = { init, frame, gpu: () => gpuInfo };
