// Trailer runtime: deterministic motion graphics addressed by time.
// The renderer calls `trailer.init(config)` once, then `await trailer.frame(t)` for every
// frame and screenshots the page. Nothing here depends on wall-clock time, so a frame
// always looks the same no matter how slowly it renders.
(() => {
  const E = {
    linear: (x) => x,
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    inCubic: (x) => x * x * x,
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
    inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
    outBack: (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2),
    inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  };
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const lerp = (a, b, x) => a + (b - a) * x;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function rand(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (a, b) => rand((a * 73856093) ^ (b * 19349663))();

  function el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }

  // Interpolates keyframes [{at: 0..1, ...numbers}] at x.
  function keyed(keys, x, ease = E.inOutCubic) {
    if (!keys || !keys.length) return {};
    if (x <= keys[0].at) return keys[0];
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1], b = keys[i];
      if (x <= b.at) {
        const k = (b.ease ? E[b.ease] : ease)((x - a.at) / (b.at - a.at || 1));
        const o = {};
        for (const key in b) o[key] = typeof b[key] === "number" && typeof a[key] === "number" ? lerp(a[key], b[key], k) : b[key];
        return o;
      }
    }
    return keys[keys.length - 1];
  }

  // Text that decodes from glyph noise into the final string.
  const GLYPHS = "▓▒░█▚▞/\\<>_=+*#01";
  function scramble(text, x, seed) {
    const n = text.length;
    let out = "";
    for (let i = 0; i < n; i++) {
      const c = text[i];
      if (c === " " || x * (n + 4) - 4 > i) out += c;
      else if (x * (n + 4) > i) out += GLYPHS[Math.floor(hash(seed + Math.floor(x * 20), i) * GLYPHS.length)];
      else out += "\u00a0";
    }
    return out;
  }

  // Masked word-by-word rise.
  function rise(parent, cls, text) {
    const box = el("div", cls, parent);
    const words = String(text).split(" ").map((w) => {
      const mask = el("span", "mask", box);
      const inner = el("span", "", mask, esc(w));
      box.appendChild(document.createTextNode(" "));
      return inner;
    });
    return (lt, delay = 0, stagger = 0.06) => {
      words.forEach((w, i) => {
        const x = E.outExpo(prog(lt, delay + i * stagger, delay + i * stagger + 0.8));
        w.style.transform = `translateY(${(1 - x) * 112}%) rotate(${(1 - x) * 5}deg)`;
      });
    };
  }

  // ---------- shared pieces ----------

  function headline(parent, s, cls) {
    const box = el("div", `head ${cls || ""}`, parent);
    const kicker = el("div", "kicker", box);
    const title = rise(box, "title", s.title || "");
    const sub = s.sub ? el("div", "sub", box, esc(s.sub)) : null;
    const chips = el("div", "chips", box);
    const chipEls = (s.chips || []).map((c) => el("span", "chip", chips, esc(c)));
    return (lt) => {
      const k = (s.index ? `${String(s.index).padStart(2, "0")} — ` : "") + (s.kicker || "");
      kicker.textContent = scramble(k, prog(lt, 0.05, 0.6), s.seed);
      title(lt, 0.12);
      if (sub) {
        const x = E.outCubic(prog(lt, 0.55, 1.15));
        sub.style.opacity = x;
        sub.style.transform = `translateY(${(1 - x) * 18}px)`;
      }
      chipEls.forEach((c, i) => {
        const x = prog(lt, 0.85 + i * 0.09, 1.3 + i * 0.09);
        c.style.opacity = Math.min(1, x * 2);
        c.style.transform = `scale(${0.6 + 0.4 * E.outBack(x)})`;
      });
    };
  }

  function footageImage(img, clip, lt, ctx) {
    const idx = clamp(Math.round((lt + clip.pre) * ctx.fps), 0, clip.frames - 1);
    const src = `frames/${clip.dir}/${String(idx + 1).padStart(5, "0")}.jpg`;
    if (img.dataset.src === src) return null;
    img.dataset.src = src;
    img.src = src;
    return img.decode().catch(() => {});
  }

  // Camera over footage. Keys: {at, z, x, y} where x/y is the focus point (0..1).
  function camera(cam, view, s, x) {
    const c = keyed(s.camera || [{ at: 0, z: 1, x: 0.5, y: 0.5 }], x);
    const w = view.clientWidth, h = view.clientHeight, z = c.z ?? 1;
    const fx = clamp(c.x ?? 0.5, 0.5 / z, 1 - 0.5 / z), fy = clamp(c.y ?? 0.5, 0.5 / z, 1 - 0.5 / z);
    cam.style.transform = `translate(${w / 2 - fx * w * z}px, ${h / 2 - fy * h * z}px) scale(${z})`;
    return z;
  }

  function callouts(cam, s) {
    return (s.callouts || []).map((c) => {
      const box = el("div", "callout", cam);
      const [x, y, w, h] = c.rect;
      Object.assign(box.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
      const label = c.label ? el("span", "callout-label", box, esc(c.label)) : null;
      return (x0, z) => {
        const a = E.outExpo(prog(x0, c.at[0], c.at[0] + 0.08)) * (1 - prog(x0, c.at[1] - 0.04, c.at[1]));
        box.style.opacity = a;
        box.style.borderWidth = `${3 / z}px`;
        box.style.transform = `scale(${1.15 - 0.15 * a})`;
        if (label) label.style.transform = `scale(${1 / z})`;
      };
    });
  }

  // ---------- scene types ----------

  const SCENES = {
    logo(root, s, ctx) {
      const box = el("div", "logo", root);
      const cell = s.cell || 12, grid = ctx.icon?.size || 24;
      const icon = el("div", "pix", box);
      icon.style.width = icon.style.height = `${grid * cell}px`;
      const r = rand(11);
      const px = (ctx.icon?.rects || []).map((p) => {
        const d = el("i", "", icon);
        d.style.cssText = `left:${p.x * cell}px;top:${p.y * cell}px;width:${p.w * cell + 0.5}px;height:${p.h * cell + 0.5}px;background:${p.fill}`;
        const ang = r() * Math.PI * 2, dist = 260 + r() * 760;
        return { d, dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist, rot: (r() - 0.5) * 220, delay: (Math.hypot(p.x - grid / 2, p.y - grid / 2) / grid) * 0.9 + r() * 0.3 };
      });
      const title = el("div", "logo-title", box);
      const tag = el("div", "logo-tag", box);
      return (lt) => {
        for (const q of px) {
          const x = E.outExpo(prog(lt, q.delay, q.delay + 1));
          q.d.style.transform = `translate(${(1 - x) * q.dx}px,${(1 - x) * q.dy}px) rotate(${(1 - x) * q.rot}deg) scale(${0.2 + 0.8 * x})`;
          q.d.style.opacity = Math.min(1, x * 1.6);
        }
        const tx = prog(lt, 1.3, 2.1);
        title.textContent = scramble(s.title, tx, 3);
        title.style.letterSpacing = `${lerp(0.7, 0.14, E.outExpo(prog(lt, 1.3, 2.5)))}em`;
        title.style.opacity = tx > 0 ? 1 : 0;
        const n = Math.round(prog(lt, 2.3, 3.1) * (s.tagline || "").length);
        tag.innerHTML = esc((s.tagline || "").slice(0, n)) + `<b class="caret${lt > 2.2 && Math.floor(lt * 3) % 2 === 0 ? "" : " off"}"></b>`;
        box.style.transform = `scale(${1 + lt * 0.015})`;
      };
    },

    words(root, s) {
      const box = el("div", "words", root);
      const kicker = s.kicker ? el("div", "words-k", box) : null;
      const word = el("div", "words-w", box);
      const streaks = [el("i", "streak", root), el("i", "streak b", root)];
      const per = s.dur / s.words.length;
      return (lt) => {
        const i = clamp(Math.floor(lt / per), 0, s.words.length - 1);
        const local = lt - i * per;
        word.textContent = s.words[i];
        word.classList.toggle("accent", i === s.words.length - 1 && s.accentLast !== false);
        const x = E.outExpo(clamp(local / 0.4));
        const out = i < s.words.length - 1 ? E.inCubic(prog(local, per - 0.09, per)) : 0;
        word.style.transform = `scale(${1.4 - 0.4 * x + out * 0.15})`;
        word.style.filter = `blur(${(1 - x) * 16 + out * 10}px)`;
        word.style.opacity = Math.min(1, x * 1.5) * (1 - out);
        if (kicker) kicker.textContent = scramble(s.kicker, prog(lt, 0, 0.5), 9);
        streaks.forEach((st, k) => {
          const p = E.outExpo(prog(local, 0, 0.45));
          st.style.transform = `translateX(${(k ? -1 : 1) * lerp(-120, 120, p)}vw)`;
          st.style.opacity = 1 - p;
        });
      };
    },

    footage(root, s, ctx) {
      const layout = s.layout || "stage";
      const win = el("div", `win ${layout} ${s.side || "right"}`, root);
      el("div", "win-glow", win);
      el("div", "win-bar", win, `<i></i><i></i><i></i><span>${esc(s.windowTitle || "")}</span>`);
      const view = el("div", "win-view", win);
      const cam = el("div", "cam", view);
      const img = el("img", "", cam);
      const calls = callouts(cam, s);
      const glow = win.querySelector(".win-glow");
      const head = headline(root, s, layout === "stage" ? "card" : `side ${s.side === "left" ? "right" : "left"}`);
      const flip = s.side === "left" ? 1 : -1;
      return (lt) => {
        const x = clamp(lt / s.dur);
        const e = E.outExpo(prog(lt, 0, 1));
        const t = keyed(s.tilt || [{ at: 0, ry: layout === "stage" ? -6 : 9 * flip, rx: 4 }, { at: 1, ry: layout === "stage" ? -2 : 3 * flip, rx: 1 }], x, E.linear);
        win.style.transform = `translate3d(0, ${(1 - e) * 90}px, 0) perspective(2200px) rotateY(${t.ry}deg) rotateX(${t.rx + (1 - e) * 10}deg)`;
        win.style.opacity = Math.min(1, e * 1.4);
        glow.style.opacity = 0.45 + 0.3 * ctx.pulse;
        const z = camera(cam, view, s, x);
        calls.forEach((c) => c(x, z));
        head(lt);
        return footageImage(img, s.clip, lt, ctx);
      };
    },

    phone(root, s, ctx) {
      const side = s.side || "right";
      const dev = el("div", `phone-dev ${side}`, root);
      el("div", "phone-halo", dev);
      const scr = el("div", "phone-scr", dev);
      const cam = el("div", "cam", scr);
      const img = el("img", "", cam);
      el("div", "island", dev);
      const head = headline(root, s, `side ${side === "left" ? "right" : "left"}`);
      const flip = side === "left" ? 1 : -1;
      return (lt) => {
        const e = E.outExpo(prog(lt, 0, 1.1));
        const float = Math.sin(lt * 1.7) * 10;
        const ry = flip * lerp(28, 12, e) + Math.sin(lt * 0.9) * 2;
        dev.style.transform = `translate3d(0, ${(1 - e) * 220 + float}px, 0) perspective(1800px) rotateY(${ry}deg) rotateZ(${-flip * lerp(6, 2, e)}deg)`;
        dev.style.opacity = Math.min(1, e * 1.5);
        camera(cam, scr, s, clamp(lt / s.dur));
        head(lt);
        return footageImage(img, s.clip, lt, ctx);
      };
    },

    // "Too many apps" → one answer. Item chips pop in with badges and drift, get struck
    // through, then are pulled into the centre where the title lands. Timing comes from
    // s.cue (computed by render.mjs so the soundtrack can hit the same moments).
    collapse(root, s) {
      const box = el("div", "collapse", root);
      const kick = s.kicker ? el("div", "col-kick", box) : null;
      const r = rand(s.seed + 3);
      const n = s.items.length;
      const swatches = ["#60a5fa", "#f472b6", "#a78bfa", "#fb923c", "#34d399", "#facc15", "#22d3ee", "#f87171"];
      const items = s.items.map((name, i) => {
        const ang = -Math.PI / 2 + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.35;
        const rx = 600 + r() * 160, ry = 270 + r() * 50;
        const e = el("div", "col-item", box, `<i style="background:${swatches[i % swatches.length]}"></i><span>${esc(name)}</span><em></em><b class="strike"></b>`);
        return { e, badge: e.querySelector("em"), strike: e.querySelector(".strike"), x: 960 + Math.cos(ang) * rx, y: 580 + Math.sin(ang) * ry, rot: (r() - 0.5) * 12, ph: r() * 6, at: s.cue.appear[i], max: 2 + Math.floor(r() * 30) };
      });
      const center = el("div", "col-center", box);
      const head = headline(center, { title: s.title, sub: s.sub, kicker: s.answerKicker, chips: s.chips, seed: s.seed }, "center");
      const ring = el("i", "col-ring", box);
      const { strike, suck, title } = s.cue;
      return (lt) => {
        const chaos = 3 + 12 * prog(lt, 0, strike);
        items.forEach((it, i) => {
          const a = E.outBack(prog(lt, it.at, it.at + 0.45));
          const sx = E.outExpo(prog(lt, strike + i * 0.035, strike + i * 0.035 + 0.35));
          const k = E.inExpo(prog(lt, suck + i * 0.025, suck + i * 0.025 + 0.5));
          const wob = Math.sin(lt * 2.6 + it.ph) * chaos, wob2 = Math.cos(lt * 2.1 + it.ph) * chaos * 0.6;
          const x = lerp(it.x + wob, 960, k), y = lerp(it.y + wob2, 540, k);
          it.e.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${it.rot * (1 - k) + Math.sin(lt * 1.7 + it.ph) * chaos * 0.15}deg) scale(${Math.max(0, a) * (1 - 0.85 * k)})`;
          it.e.style.opacity = (lt >= it.at ? 1 : 0) * (1 - prog(k, 0.7, 1));
          it.e.classList.toggle("dim", sx > 0.5);
          it.strike.style.transform = `scaleX(${sx})`;
          const count = Math.max(1, Math.round(it.max * prog(lt, it.at + 0.2, strike)));
          it.badge.textContent = count > 9 ? "9+" : String(count);
          it.badge.style.transform = `scale(${E.outBack(prog(lt, it.at + 0.25, it.at + 0.6))})`;
        });
        if (kick) {
          kick.textContent = scramble(s.kicker, prog(lt, 0.05, 0.7), s.seed);
          kick.style.opacity = 1 - prog(lt, suck - 0.1, suck + 0.3);
        }
        const rg = prog(lt, title - 0.1, title + 0.8);
        ring.style.transform = `translate(-50%, -50%) scale(${0.2 + 3.2 * E.outExpo(rg)})`;
        ring.style.opacity = rg > 0 ? 0.9 * (1 - rg) : 0;
        center.style.opacity = lt >= title - 0.05 ? 1 : 0;
        head(lt - title);
      };
    },

    // Rapid, beat-synced cuts through several clips in one window, with a big label per cut.
    montage(root, s, ctx) {
      const win = el("div", "win center", root);
      const glow = el("div", "win-glow", win);
      const bar = el("div", "win-bar", win, "<i></i><i></i><i></i><span></span>");
      const barTitle = bar.querySelector("span");
      const view = el("div", "win-view", win);
      const cam = el("div", "cam", view);
      const img = el("img", "", cam);
      const kick = s.kicker ? el("div", "mont-kick", root) : null;
      const labels = s.clips.map((c) => {
        const wrap = el("div", "mont-label", root);
        return { wrap, rise: rise(wrap, "mont-word", c.label || "") };
      });
      const count = el("div", "mont-count", root);
      const n = s.clips.length;
      return (lt) => {
        let i = s.clips.findIndex((c) => lt < c.start + c.dur);
        if (i < 0) i = n - 1;
        const c = s.clips[i], cl = lt - c.start, x = clamp(cl / c.dur);
        const enter = E.outExpo(prog(lt, 0, 0.9));
        const punch = E.outExpo(clamp(cl / 0.3));
        const flip = i % 2 ? 1 : -1;
        win.style.transform = `translate3d(0, ${(1 - enter) * 120}px, 0) perspective(2400px) rotateY(${flip * lerp(6, 2.5, x)}deg) rotateX(${2 + (1 - enter) * 10}deg) scale(${lerp(1.07, 1, punch)})`;
        win.style.opacity = Math.min(1, enter * 1.4);
        glow.style.opacity = 0.4 + 0.4 * ctx.pulse;
        barTitle.textContent = c.windowTitle || "";
        camera(cam, view, { camera: c.camera || [{ at: 0, z: 1.02, x: 0.5, y: 0.5 }, { at: 1, z: 1.14, x: c.x ?? 0.5, y: c.y ?? 0.5 }] }, x);
        labels.forEach((l, k) => {
          l.wrap.style.display = k === i ? "block" : "none";
          if (k === i) l.rise(cl, 0.02, 0.05);
        });
        if (kick) kick.textContent = scramble(s.kicker, prog(lt, 0, 0.6), s.seed);
        count.textContent = `${String(i + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}`;
        return footageImage(img, c, cl, ctx);
      };
    },

    counters(root, s) {
      const box = el("div", "counters", root);
      const head = headline(box, s, "center");
      const row = el("div", "count-row", box);
      const items = s.items.map((it) => {
        const cell = el("div", "count", row);
        const num = el("div", "count-n", cell);
        const line = el("i", "count-line", cell);
        el("div", "count-l", cell, esc(it.label));
        return { it, cell, num, line };
      });
      return (lt) => {
        head(lt);
        items.forEach(({ it, cell, num, line }, i) => {
          const a = 0.45 + i * 0.16;
          const x = E.outExpo(prog(lt, a, a + 1.4));
          num.textContent = `${it.prefix || ""}${Math.round(it.value * x)}${it.suffix || ""}`;
          cell.style.opacity = Math.min(1, prog(lt, a, a + 0.3) * 1.2);
          cell.style.transform = `translateY(${(1 - E.outExpo(prog(lt, a, a + 0.8))) * 40}px)`;
          line.style.transform = `scaleX(${E.outExpo(prog(lt, a + 0.2, a + 1.2))})`;
        });
      };
    },

    outro(root, s, ctx) {
      const box = el("div", "outro", root);
      const cell = s.cell || 6, grid = ctx.icon?.size || 24;
      const icon = el("div", "pix", box);
      icon.style.width = icon.style.height = `${grid * cell}px`;
      const px = (ctx.icon?.rects || []).map((p) => {
        const d = el("i", "", icon);
        d.style.cssText = `left:${p.x * cell}px;top:${p.y * cell}px;width:${p.w * cell + 0.5}px;height:${p.h * cell + 0.5}px;background:${p.fill}`;
        return { d, delay: hash(p.x + 1, p.y + 1) * 0.5 };
      });
      const title = el("div", "outro-title", box);
      const tag = rise(box, "outro-tag", s.tagline || "");
      const cmd = s.command || s.cta ? el("div", s.cta ? "cmd cta" : "cmd", box) : null;
      const foot = el("div", "outro-foot", box, esc(s.footer || ""));
      const black = el("div", "black", root);
      return (lt) => {
        for (const q of px) q.d.style.transform = `scale(${Math.max(0, E.outBack(prog(lt, q.delay, q.delay + 0.5)))})`;
        title.textContent = scramble(s.title, prog(lt, 0.4, 1.1), 5);
        tag(lt, 0.9);
        if (cmd) {
          const text = s.cta || s.command;
          const n = Math.round(prog(lt, 1.6, 2.6) * text.length);
          const prompt = s.cta ? "" : `<span class="prompt">$</span> `;
          cmd.innerHTML = `${prompt}${esc(text.slice(0, n))}<b class="caret${Math.floor(lt * 3) % 2 ? " off" : ""}"></b>`;
          cmd.style.opacity = prog(lt, 1.4, 1.7);
        }
        foot.style.opacity = prog(lt, 2.6, 3.4);
        box.style.transform = `scale(${1.04 - 0.04 * E.outExpo(prog(lt, 0, 2))})`;
        black.style.opacity = prog(lt, s.dur - 1, s.dur - 0.1);
      };
    },
  };

  // ---------- stage ----------

  const OVERLAP = { zoom: 0.35, slide: 0.32 };
  const ctx = { fps: 30, pulse: 0, icon: null };
  let cfg, scenes, L;

  function init(config) {
    cfg = config;
    ctx.fps = cfg.fps;
    ctx.icon = cfg.icon;
    const stage = document.getElementById("stage");
    stage.style.setProperty("--accent", cfg.theme.accent);
    stage.style.setProperty("--accent2", cfg.theme.accent2);
    L = {
      floor: el("div", "floor", stage),
      glowA: el("div", "glow a", stage),
      glowB: el("div", "glow b", stage),
      motes: el("div", "motes", stage),
      scenes: el("div", "scenes", stage),
      hud: el("div", "hud", stage),
      flash: el("div", "flash", stage),
      pixels: el("div", "pixels", stage),
      vignette: el("div", "vignette", stage),
    };
    const r = rand(5);
    L.moteEls = Array.from({ length: 46 }, () => {
      const m = el("i", "", L.motes);
      const size = 3 + Math.floor(r() * 4) * 3;
      const roll = r();
      m.style.cssText = `width:${size}px;height:${size}px;background:${roll < 0.18 ? cfg.theme.accent2 : roll < 0.6 ? cfg.theme.accent : "#ffffff"}`;
      return { m, x: r() * 1920, y: r() * 1180, v: 8 + r() * 26, tw: r() * 6, o: 0.08 + r() * 0.3 };
    });
    L.cells = [];
    const cols = 16, rows = 9;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const c = el("i", "", L.pixels);
      c.style.left = `${x * 120}px`;
      c.style.top = `${y * 120}px`;
      const roll = r();
      c.style.background = roll < 0.12 ? cfg.theme.accent : roll < 0.17 ? cfg.theme.accent2 : roll < 0.55 ? cfg.theme.cell || "#0b1d17" : cfg.theme.bg;
      L.cells.push({ c, order: ((x + y) / (cols + rows - 2)) * 0.75 + r() * 0.25 });
    }
    L.hud.innerHTML = `<div class="hud-brand"><b></b><span>${esc(cfg.brand || "")}</span></div><div class="hud-chapter"></div><div class="hud-bar"><i></i></div>`;
    L.chapter = L.hud.querySelector(".hud-chapter");
    L.bar = L.hud.querySelector(".hud-bar i");

    let chapter = 0;
    scenes = cfg.scenes.map((s, i) => {
      if (s.type === "footage" || s.type === "phone") s.index = ++chapter;
      s.seed = i * 31 + 7;
      const wrap = el("div", `scene ${s.type}`, L.scenes);
      const update = SCENES[s.type](wrap, s, ctx);
      const next = cfg.scenes[i + 1];
      return { s, wrap, update, pre: OVERLAP[s.transition] || 0, post: next ? OVERLAP[next.transition] || 0 : 0, nextTransition: next?.transition };
    });
    L.chapters = chapter;
  }

  const sceneAt = (t) => cfg.scenes.find((s) => t >= s.start && t < s.start + s.dur);

  async function frame(t) {
    const beat = 60 / cfg.bpm;
    const current = sceneAt(t);
    const energy = current?.energy ?? 0;
    ctx.pulse = energy >= 1 ? Math.exp(-((t % beat) / beat) * 5) : 0;
    const waits = [];

    L.floor.style.backgroundPosition = `0 ${(t * (30 + energy * 25)) % 80}px`;
    L.floor.style.opacity = 0.35 + 0.3 * ctx.pulse;
    L.glowA.style.transform = `translate(${Math.sin(t * 0.21) * 160}px, ${Math.cos(t * 0.17) * 90}px) scale(${1 + 0.08 * ctx.pulse})`;
    L.glowB.style.transform = `translate(${Math.cos(t * 0.13) * 200}px, ${Math.sin(t * 0.19) * 120}px)`;
    for (const p of L.moteEls) {
      const y = ((((p.y - t * p.v) % 1180) + 1180) % 1180) - 50;
      p.m.style.transform = `translate(${p.x + Math.sin(t * 0.5 + p.tw) * 20}px, ${y}px)`;
      p.m.style.opacity = p.o * (0.55 + 0.45 * Math.sin(t * 2 + p.tw)) * (1 + ctx.pulse * 0.6);
    }

    for (const sc of scenes) {
      const { s } = sc;
      const on = t >= s.start - sc.pre && t < s.start + s.dur + sc.post;
      sc.wrap.style.display = on ? "block" : "none";
      if (!on) continue;
      const lt = t - s.start;
      let opacity = 1, scale = 1, tx = 0, blur = 0;
      if (sc.pre && lt < sc.pre) {
        const k = prog(lt, -sc.pre, sc.pre);
        if (s.transition === "zoom") { opacity = E.outCubic(k); scale = 0.82 + 0.18 * E.outExpo(k); blur = (1 - k) * 10; }
        if (s.transition === "slide") { tx = (1 - E.inOutExpo(k)) * 100; blur = Math.sin(Math.PI * k) * 10; }
      }
      if (sc.post && lt > s.dur - sc.post) {
        const k = prog(lt, s.dur - sc.post, s.dur + sc.post);
        if (sc.nextTransition === "zoom") { opacity = 1 - E.inCubic(k); scale = 1 + 0.35 * E.inExpo(k); blur = k * 12; }
        if (sc.nextTransition === "slide") { tx = -E.inOutExpo(k) * 100; blur = Math.sin(Math.PI * k) * 10; }
      }
      if (s.transition === "flash" && lt >= 0 && lt < 0.6) scale = 1 + 0.08 * (1 - E.outExpo(lt / 0.6));
      sc.wrap.style.opacity = opacity;
      sc.wrap.style.transform = `translateX(${tx}%) scale(${scale})`;
      sc.wrap.style.filter = blur > 0.2 ? `blur(${blur}px)` : "none";
      const w = sc.update(lt);
      if (w) waits.push(w);
    }

    let flash = 0;
    const cover = new Array(L.cells.length).fill(0);
    for (const s of cfg.scenes) {
      if (s.transition === "flash" && t >= s.start) flash = Math.max(flash, 0.7 * Math.exp(-(t - s.start) * 7));
      if (s.transition === "pixels") {
        const d = 0.5, T = s.start;
        if (t > T - d / 2 && t < T + d / 2) {
          L.cells.forEach((cell, i) => {
            const a = T - d / 2 + cell.order * (d / 4), b = T + cell.order * (d / 4);
            cover[i] = Math.max(cover[i], E.outCubic(prog(t, a, a + d / 4)) * (1 - E.inCubic(prog(t, b, b + d / 4))));
          });
        }
      }
    }
    L.flash.style.opacity = flash;
    L.cells.forEach((cell, i) => { cell.c.style.transform = `scale(${cover[i] * 1.02})`; });

    const hud = current && (current.type === "footage" || current.type === "phone");
    L.hud.style.opacity = hud ? 1 : 0;
    if (hud) L.chapter.textContent = `${String(current.index).padStart(2, "0")} / ${String(L.chapters).padStart(2, "0")}   ${current.chapter || current.kicker || ""}`;
    L.bar.style.transform = `scaleX(${t / cfg.total})`;

    await Promise.all(waits);
  }

  window.trailer = { init, frame };
})();
