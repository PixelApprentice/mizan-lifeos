// Keynote style runtime: a bright, calm product-launch look.
// The renderer calls `trailer.init(config)` once, then `await trailer.frame(t)` per frame.
// Everything is a pure function of t, so any frame can be rendered on its own.
//
// Scene types: statement, logo, hero, feature, phone, list, grid, end.
// Text lines are strings or { t, tone: "dim" | "grad", at } (at = seconds into the scene).
(() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const prog = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const lerp = (a, b, k) => a + (b - a) * k;
  const E = {
    outCubic: (x) => 1 - (1 - x) ** 3,
    inCubic: (x) => x ** 3,
    outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
    inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
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

  const ctx = { fps: 30 };
  const XF = 0.7; // crossfade between scenes, seconds

  // ---------- building blocks ----------

  // Headline lines, split into words that rise out of a soft blur one after another.
  function headline(parent, lines, size = "l", firstAt = 0.25) {
    const box = el("div", `h ${size}`, parent);
    const words = [];
    let at = firstAt;
    for (const raw of lines || []) {
      const line = typeof raw === "string" ? { t: raw } : raw;
      if (line.at != null) at = line.at;
      const grad = line.tone === "grad";
      const row = el("span", `line ${grad ? "" : line.tone || ""}`, box);
      line.t.split(/(?<=\s)/).forEach((w, k) => words.push({ e: el("span", grad ? "w grad" : "w", row, esc(w)), row: grad ? row : null, at: at + k * 0.075 }));
      at += 0.075 * line.t.split(/\s+/).length + 0.2;
    }
    let laid = false;
    const update = (lt) => {
      if (!laid) {
        // One gradient across the whole line, sliced per word.
        laid = true;
        for (const w of words) if (w.row) {
          w.e.style.backgroundSize = `${w.row.offsetWidth}px 100%`;
          w.e.style.backgroundPosition = `${-(w.e.offsetLeft - w.row.offsetLeft)}px 0`;
        }
      }
      for (const w of words) {
        const p = prog(lt, w.at, w.at + 0.85);
        w.e.style.opacity = E.outCubic(p);
        w.e.style.transform = `translateY(${(1 - E.outExpo(p)) * 46}px)`;
        w.e.style.filter = p < 1 ? `blur(${(1 - p) * 14}px)` : "none";
      }
    };
    return { box, update, end: at };
  }

  // Fade + rise for any element.
  function rise(e, lt, at, dist = 30, dur = 0.9) {
    const p = prog(lt, at, at + dur);
    e.style.opacity = E.outCubic(p);
    e.style.transform = `translateY(${(1 - E.outExpo(p)) * dist}px)`;
    e.style.filter = p < 1 ? `blur(${(1 - p) * 10}px)` : "none";
  }

  function footage(img, clip, lt) {
    if (!clip) return null;
    const idx = clamp(Math.round((lt + clip.pre) * ctx.fps), 0, clip.frames - 1);
    const src = `frames/${clip.dir}/${String(idx + 1).padStart(5, "0")}.jpg`;
    if (img.dataset.src === src) return null;
    img.dataset.src = src;
    img.src = src;
    return img.decode().catch(() => {});
  }

  // Slow camera inside a screen. keys: [{at, z, x, y}], x/y = focus point (0..1).
  function zoom(img, W, H, keys, lt) {
    const k = keys?.length ? keys : [{ at: 0, z: 1, x: 0.5, y: 0.5 }];
    let a = k[0], b = k[0], f = 0;
    for (let i = 0; i < k.length; i++) {
      if (lt >= k[i].at) { a = k[i]; b = k[i + 1] || k[i]; }
    }
    if (b !== a) f = E.inOutCubic(prog(lt, a.at, b.at));
    const z = lerp(a.z ?? 1, b.z ?? 1, f), x = lerp(a.x ?? 0.5, b.x ?? 0.5, f), y = lerp(a.y ?? 0.5, b.y ?? 0.5, f);
    const ox = clamp(W / 2 - x * W * z, W - W * z, 0), oy = clamp(H / 2 - y * H * z, H - H * z, 0);
    img.style.width = `${W}px`;
    img.style.height = `${H}px`;
    img.style.transform = `translate(${ox}px, ${oy}px) scale(${z})`;
  }

  function windowShot(parent, { w, title }) {
    const h = Math.round((w * 9) / 16);
    const win = el("div", "window", parent);
    win.style.width = `${w}px`;
    const bar = el("div", "bar", win, `<i></i><i></i><i></i><span>${esc(title || "Mizan")}</span>`);
    const screen = el("div", "screen", win);
    screen.style.height = `${h}px`;
    const img = el("img", "", screen);
    const shine = el("div", "reflect", win);
    return { win, bar, screen, img, shine, w, h, H: h + 40 };
  }

  function phoneShot(parent, { h }) {
    const w = Math.round(h * 0.47);
    const dev = el("div", "device", parent);
    dev.style.width = `${w}px`;
    dev.style.height = `${h}px`;
    const screen = el("div", "screen", dev);
    el("div", "island", screen);
    const img = el("img", "", screen);
    img.style.cssText = "width:100%;height:100%;object-fit:cover;object-position:top center";
    const shine = el("div", "reflect", dev);
    return { dev, img, shine, w, h };
  }

  const shine = (e, lt, at) => { e.style.backgroundPosition = `${lerp(130, -30, E.inOutCubic(prog(lt, at, at + 1.6)))}% 0`; };

  // ---------- scenes ----------

  const SCENES = {
    statement(wrap, s) {
      const c = el("div", "center", wrap);
      const h = headline(c, s.lines, s.size || "xl", s.at ?? 0.3);
      return (lt) => {
        h.update(lt);
        c.style.transform = `scale(${1 + 0.035 * prog(lt, 0, s.dur)})`;
      };
    },

    logo(wrap, s) {
      const c = el("div", "center", wrap);
      const icon = el("div", "appicon", c, iconSvg());
      const word = el("div", "wordmark", c, esc(s.title || "Mizan"));
      const tag = el("div", "tagline", c, esc(s.tagline || ""));
      return (lt) => {
        const p = prog(lt, 0.15, 1.35);
        icon.style.opacity = E.outCubic(prog(lt, 0.15, 0.7));
        icon.style.transform = `scale(${0.55 + 0.45 * E.outBack(p)}) translateY(${(1 - E.outExpo(p)) * 60}px)`;
        icon.style.filter = p < 1 ? `blur(${(1 - p) * 18}px)` : "none";
        rise(word, lt, 0.85, 40, 1.0);
        rise(tag, lt, 1.45, 24, 1.0);
        c.style.transform = `scale(${1 + 0.04 * prog(lt, 1.2, s.dur)})`;
      };
    },

    hero(wrap, s) {
      const top = el("div", "center", wrap);
      top.style.justifyContent = "flex-start";
      top.style.paddingTop = "96px";
      const k = s.kicker ? el("div", "kicker", top, esc(s.kicker)) : null;
      const h = headline(top, s.lines, s.size || "m", 0.2);
      const shot = windowShot(wrap, { w: s.width || 1400, title: s.windowTitle });
      shot.win.style.left = `${(1920 - shot.w) / 2}px`;
      shot.win.style.top = `${s.top ?? 360}px`;
      const at = s.windowAt ?? 0.55;
      return (lt) => {
        if (k) rise(k, lt, 0.05, 16);
        h.update(lt);
        const p = E.outExpo(prog(lt, at, at + 1.7));
        const drift = prog(lt, at + 1.2, s.dur + 1);
        shot.win.style.opacity = E.outCubic(prog(lt, at, at + 0.6));
        shot.win.style.transform = `perspective(2600px) translateY(${(1 - p) * 320 - drift * 30}px) rotateX(${(1 - p) * 26}deg) scale(${0.92 + 0.08 * p + drift * 0.03})`;
        shine(shot.shine, lt, at + 0.9);
        zoom(shot.img, shot.w, shot.h, s.zoom, lt);
        return footage(shot.img, s.clip, lt);
      };
    },

    feature(wrap, s) {
      const right = s.side === "right"; // copy on the right, picture on the left
      const copy = el("div", "copy", wrap);
      copy.style.left = right ? "1180px" : "150px";
      copy.style.width = right ? "620px" : "600px";
      const k = s.kicker ? el("div", "kicker", copy, esc(s.kicker)) : null;
      const h = headline(copy, s.lines, s.size || "m", 0.25);
      const body = s.body ? el("div", "body", copy, s.body) : null;
      const shot = windowShot(wrap, { w: s.width || 1060, title: s.windowTitle });
      shot.win.style.left = right ? `${1100 - shot.w - 20}px` : "790px";
      shot.win.style.top = `${(1080 - shot.H) / 2}px`;
      const dir = right ? -1 : 1;
      return (lt) => {
        if (k) rise(k, lt, 0.1, 16);
        h.update(lt);
        if (body) rise(body, lt, h.end + 0.15, 24);
        const p = E.outExpo(prog(lt, 0.2, 1.6));
        const drift = prog(lt, 1.2, s.dur + 1);
        shot.win.style.opacity = E.outCubic(prog(lt, 0.15, 0.8));
        shot.win.style.filter = p < 0.98 ? `blur(${(1 - p) * 14}px)` : "none";
        shot.win.style.transform = `perspective(2600px) translateX(${dir * ((1 - p) * 160 - drift * 18)}px) rotateY(${-dir * ((1 - p) * 16 + 4 - drift * 2.5)}deg) scale(${0.96 + 0.04 * p + drift * 0.02})`;
        shine(shot.shine, lt, 0.8);
        zoom(shot.img, shot.w, shot.h, s.zoom, lt);
        return footage(shot.img, s.clip, lt);
      };
    },

    phone(wrap, s) {
      const duo = !!s.desktop;
      const copy = el("div", duo ? "center" : "copy", wrap);
      if (duo) { copy.style.justifyContent = "flex-start"; copy.style.paddingTop = "84px"; } else copy.style.left = "150px";
      const k = s.kicker ? el("div", "kicker", copy, esc(s.kicker)) : null;
      const h = headline(copy, s.lines, s.size || "m", 0.25);
      const body = s.body ? el("div", "body", copy, s.body) : null;
      let win = null;
      if (duo) {
        win = windowShot(wrap, { w: 1060, title: s.windowTitle });
        win.win.style.left = "330px";
        win.win.style.top = "340px";
      }
      const ph = phoneShot(wrap, { h: duo ? 760 : 900 });
      ph.dev.style.left = duo ? "1290px" : "1080px";
      ph.dev.style.top = duo ? "300px" : `${(1080 - ph.h) / 2}px`;
      return (lt) => {
        if (k) rise(k, lt, 0.1, 16);
        h.update(lt);
        if (body) rise(body, lt, h.end + 0.15, 24);
        const waits = [];
        if (win) {
          const p = E.outExpo(prog(lt, 0.45, 1.9));
          win.win.style.opacity = E.outCubic(prog(lt, 0.45, 1));
          win.win.style.transform = `perspective(2600px) translateY(${(1 - p) * 240}px) rotateX(${(1 - p) * 20}deg) scale(${0.94 + 0.06 * p})`;
          zoom(win.img, win.w, win.h, s.desktopZoom, lt);
          shine(win.shine, lt, 1.1);
          waits.push(footage(win.img, s.desktop, lt));
        }
        const at = duo ? 0.8 : 0.3;
        const p = E.outExpo(prog(lt, at, at + 1.6));
        const drift = prog(lt, at + 1.2, s.dur + 1);
        ph.dev.style.opacity = E.outCubic(prog(lt, at, at + 0.6));
        ph.dev.style.filter = p < 0.98 ? `blur(${(1 - p) * 12}px)` : "none";
        ph.dev.style.transform = `perspective(2200px) translateY(${(1 - p) * 220 - drift * 16}px) rotateY(${(1 - p) * -22 - 6 + drift * 4}deg) rotateZ(${(1 - p) * 4}deg)`;
        shine(ph.shine, lt, at + 0.7);
        waits.push(footage(ph.img, s.clip, lt));
        return Promise.all(waits);
      };
    },

    list(wrap, s) {
      const c = el("div", "center", wrap);
      const rows = (s.items || []).map((t, i) => ({ e: el("div", "h l line", c, esc(t)), at: 0.3 + i * (s.step ?? 0.75) }));
      const fin = s.final ? el("div", `h l line ${s.finalTone || "grad"}`, c, esc(s.final)) : null;
      if (fin) fin.style.marginTop = "34px";
      const finAt = 0.3 + rows.length * (s.step ?? 0.75) + 0.25;
      return (lt) => {
        rows.forEach((r, i) => {
          rise(r.e, lt, r.at, 40, 0.8);
          const next = rows[i + 1]?.at ?? (fin ? finAt : Infinity);
          r.e.style.opacity = E.outCubic(prog(lt, r.at, r.at + 0.8)) * lerp(1, 0.22, E.outCubic(prog(lt, next, next + 0.6)));
        });
        if (fin) rise(fin, lt, finAt, 40, 1.0);
        if (fin) fin.style.backgroundPosition = `${lerp(100, 0, prog(lt, finAt, s.dur))}% 0`;
      };
    },

    grid(wrap, s) {
      const title = el("div", "grid-title", wrap);
      const h = headline(title, s.lines, s.size || "m", 0.2);
      const g = el("div", "grid", wrap);
      g.style.gridTemplateColumns = `repeat(${s.cols || 4}, 1fr)`;
      const tiles = (s.tiles || []).map((t, i) => {
        const e = el("div", `tile ${t.dark ? "dark" : ""}`, g, `<div class="big ${t.grad ? "grad" : ""}">${esc(t.big)}</div><div class="label">${esc(t.label || "")}</div>`);
        if (t.span) e.style.gridColumn = `span ${t.span}`;
        if (t.rows) e.style.gridRow = `span ${t.rows}`;
        return { e, at: 0.7 + i * 0.13 };
      });
      return (lt) => {
        h.update(lt);
        for (const t of tiles) {
          const p = prog(lt, t.at, t.at + 1.0);
          t.e.style.opacity = E.outCubic(p);
          t.e.style.transform = `translateY(${(1 - E.outExpo(p)) * 70}px) scale(${0.94 + 0.06 * E.outCubic(p)})`;
        }
        g.style.transform = `scale(${1 + 0.02 * prog(lt, 1, s.dur)})`;
      };
    },

    end(wrap, s) {
      const c = el("div", "center", wrap);
      const icon = el("div", "appicon", c, iconSvg());
      icon.style.transform = "scale(0.62)";
      const word = el("div", "wordmark", c, esc(s.title || "Mizan"));
      word.style.marginTop = "0";
      const tag = el("div", "tagline", c, esc(s.tagline || ""));
      const pill = s.cta ? el("div", "pill", c, esc(s.cta)) : null;
      const fine = s.fine ? el("div", "fine", c, esc(s.fine)) : null;
      if (fine) fine.style.marginTop = "34px";
      const fade = el("div", "fill", wrap);
      return (lt) => {
        const p = prog(lt, 0.1, 1.1);
        icon.style.opacity = E.outCubic(p);
        icon.style.transform = `scale(${0.5 + 0.12 * E.outBack(p)})`;
        rise(word, lt, 0.4, 36);
        rise(tag, lt, 0.9, 24);
        if (pill) rise(pill, lt, 1.5, 24);
        if (fine) rise(fine, lt, 1.9, 18);
        fade.style.opacity = E.inOutCubic(prog(lt, s.dur - 1.2, s.dur - 0.1));
      };
    },
  };

  function iconSvg() {
    const ic = ctx.icon;
    if (!ic) return "";
    return `<svg viewBox="0 0 ${ic.size} ${ic.size}" xmlns="http://www.w3.org/2000/svg">${ic.rects.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.fill}"/>`).join("")}</svg>`;
  }

  // ---------- frame loop ----------

  let cfg, scenes, glows;

  function init(config) {
    cfg = config;
    ctx.fps = cfg.fps;
    ctx.icon = cfg.icon;
    const stage = document.getElementById("stage");
    glows = ["a", "b", "c"].map((k) => el("div", `glow ${k}`, stage));
    const layer = el("div", "", stage);
    scenes = cfg.scenes.map((s, i) => {
      const wrap = el("div", `scene s-${s.type}`, layer);
      const update = SCENES[s.type](wrap, s);
      const next = cfg.scenes[i + 1];
      return { s, wrap, update, pre: i && s.transition !== "cut" ? XF : 0, post: next && next.transition !== "cut" ? XF : 0 };
    });
  }

  async function frame(t) {
    const cur = cfg.scenes.find((s) => t >= s.start && t < s.start + s.dur) || cfg.scenes[cfg.scenes.length - 1];
    const g = cur.glow ?? 0.6;
    glows[0].style.transform = `translate(${Math.sin(t * 0.16) * 180}px, ${Math.cos(t * 0.12) * 110}px)`;
    glows[1].style.transform = `translate(${Math.cos(t * 0.11) * 220}px, ${Math.sin(t * 0.14) * 120}px)`;
    glows[2].style.transform = `translate(${Math.sin(t * 0.09 + 1) * 260}px, ${Math.cos(t * 0.1) * 140}px)`;
    for (const e of glows) e.style.opacity = g;

    const waits = [];
    for (const sc of scenes) {
      const { s } = sc;
      const on = t >= s.start - sc.pre && t < s.start + s.dur + sc.post;
      sc.wrap.style.display = on ? "block" : "none";
      if (!on) continue;
      const lt = t - s.start;
      let opacity = 1, scale = 1, blur = 0, y = 0;
      if (sc.post && lt > s.dur - sc.post * 0.3) {
        // Leave a little before the next scene arrives: fade, sink back, soften.
        const k = E.inOutCubic(prog(lt, s.dur - sc.post * 0.3, s.dur + sc.post * 0.7));
        opacity = 1 - k;
        scale = 1 - 0.04 * k;
        blur = 10 * k;
        y = -30 * k;
      }
      sc.wrap.style.opacity = opacity;
      sc.wrap.style.transform = `translateY(${y}px) scale(${scale})`;
      sc.wrap.style.filter = blur > 0.2 ? `blur(${blur}px)` : "none";
      const w = sc.update(lt);
      if (w) waits.push(w);
    }
    await Promise.all(waits);
  }

  window.trailer = { init, frame };
})();
