// Visual layer for the demo video: a visible cursor (headless browsers draw none),
// lower-third captions and full-screen title cards. Injected into every recorded page.

export function overlay() {
  // The phone page runs in an iframe; the top page draws its cursor. Inside the frame,
  // stand in for the Android app's bridge so "Full" goes immersive inside the phone.
  if (window.top !== window) {
    window.MizanAndroid = { keepScreenOn() {}, setImmersive() {}, localAddresses: () => "[]" };
    return;
  }
  if (window.__demo) return;
  const css = `
    #demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;
      transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))}
    #demo-ring{position:fixed;width:38px;height:38px;margin:-19px 0 0 -19px;border:2px solid #6ee7b7;border-radius:50%;
      z-index:2147483646;pointer-events:none;opacity:0;transform:scale(.4)}
    #demo-ring.on{animation:demo-ring .45s ease-out}
    @keyframes demo-ring{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(1.4)}}
    #demo-caption{position:fixed;right:28px;bottom:26px;max-width:640px;z-index:2147483640;pointer-events:none;
      background:rgba(6,8,8,.94);border:1px solid #1f3b31;border-left:3px solid #6ee7b7;padding:14px 20px 15px;
      font-family:"JetBrains Mono",ui-monospace,monospace;color:#f4f4f5;box-shadow:0 10px 40px rgba(0,0,0,.55);
      opacity:0;transform:translateY(14px);transition:opacity .35s ease,transform .35s ease}
    #demo-caption.on{opacity:1;transform:none}
    #demo-caption small{display:block;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#6ee7b7;margin-bottom:6px}
    #demo-caption b{display:block;font-size:20px;line-height:1.3;font-weight:600}
    #demo-caption span{display:block;font-size:14px;line-height:1.45;color:#a1a1aa;margin-top:6px}
    #demo-card{position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;justify-content:center;
      padding:0 120px;background:radial-gradient(120% 90% at 20% 10%,#0c1f19 0%,#050606 55%,#030303 100%);
      font-family:"JetBrains Mono",ui-monospace,monospace;color:#f4f4f5;opacity:0;pointer-events:none;transition:opacity .5s ease}
    #demo-card.on{opacity:1}
    #demo-card .k{font-size:14px;letter-spacing:.3em;text-transform:uppercase;color:#6ee7b7}
    #demo-card h1{font-size:60px;line-height:1.05;margin:18px 0 0;font-weight:700;letter-spacing:-.01em}
    #demo-card p{font-size:21px;line-height:1.5;color:#a1a1aa;margin:20px 0 0;max-width:900px}
    #demo-card ul{list-style:none;padding:0;margin:30px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:12px 40px;max-width:1000px}
    #demo-card li{font-size:18px;color:#e4e4e7;opacity:0;transform:translateY(8px);transition:opacity .4s ease,transform .4s ease}
    #demo-card li.on{opacity:1;transform:none}
    #demo-card li::before{content:"✓  ";color:#6ee7b7;font-weight:700}
    #demo-card .scale{display:flex;gap:6px;margin-bottom:6px}
    #demo-card .scale i{width:14px;height:14px;background:#6ee7b7;display:block}
    #demo-card .scale i:nth-child(2){background:#eab308}`;
  const cursorSvg = `<svg viewBox="0 0 22 22" width="22" height="22"><path d="M2 1 L2 18 L6.5 13.8 L9.6 20.6 L12.6 19.2 L9.6 12.6 L15.6 12.6 Z"
    fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  let cursor, ring, caption, card;
  const ready = () => {
    if (cursor) return;
    const style = document.createElement("style");
    style.textContent = css;
    document.documentElement.appendChild(style);
    cursor = Object.assign(document.createElement("div"), { id: "demo-cursor", innerHTML: cursorSvg });
    ring = Object.assign(document.createElement("div"), { id: "demo-ring" });
    caption = Object.assign(document.createElement("div"), { id: "demo-caption" });
    card = Object.assign(document.createElement("div"), { id: "demo-card" });
    document.documentElement.append(card, caption, ring, cursor);
  };
  const place = (x, y) => { ready(); cursor.style.transform = `translate(${x - 2}px,${y - 1}px)`; ring.style.left = `${x}px`; ring.style.top = `${y}px`; };
  const pulse = () => { ready(); ring.classList.remove("on"); void ring.offsetWidth; ring.classList.add("on"); };
  const track = (target, offset) => {
    target.addEventListener("mousemove", (e) => { const o = offset(); place(o.x + e.clientX * o.s, o.y + e.clientY * o.s); }, true);
    target.addEventListener("mousedown", pulse, true);
  };
  track(window, () => ({ x: 0, y: 0, s: 1 }));
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  window.__demo = {
    ready,
    caption(kicker, title, sub) {
      ready();
      caption.classList.remove("on");
      setTimeout(() => {
        caption.innerHTML = `<small>${esc(kicker)}</small><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}`;
        caption.classList.add("on");
      }, caption.innerHTML ? 250 : 0);
    },
    clearCaption() { ready(); caption.classList.remove("on"); },
    card({ kicker, title, sub, items = [] }) {
      ready();
      card.innerHTML = `<div class="scale"><i></i><i></i><i></i></div><div class="k">${esc(kicker)}</div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
      card.classList.add("on");
      card.querySelectorAll("li").forEach((li, i) => setTimeout(() => li.classList.add("on"), 500 + i * 260));
    },
    hideCard() { ready(); card.classList.remove("on"); },
    /** Follow the mouse inside a scaled, same-origin iframe. */
    trackFrame(frame, scale) {
      const hook = () => track(frame.contentWindow, () => { const r = frame.getBoundingClientRect(); return { x: r.left, y: r.top, s: scale }; });
      if (frame.contentDocument?.readyState === "complete") hook();
      frame.addEventListener("load", hook);
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else ready();
}

/** 1280×720 stage: talking points on the left, the real phone page in a phone frame on the right. */
export function stageHtml(src, scale) {
  const w = 390, h = 844;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Mizan companion</title><style>
  html,body{margin:0;height:100%;background:radial-gradient(110% 90% at 85% 20%,#0b1d17 0%,#050606 55%,#030303 100%);overflow:hidden;
    font-family:"JetBrains Mono",ui-monospace,monospace;color:#f4f4f5}
  .left{position:absolute;left:90px;top:0;bottom:0;width:600px;display:flex;flex-direction:column;justify-content:center}
  .k{font-size:13px;letter-spacing:.3em;text-transform:uppercase;color:#6ee7b7}
  h1{font-size:40px;line-height:1.15;margin:16px 0 0;transition:opacity .3s ease}
  p{font-size:18px;line-height:1.55;color:#a1a1aa;margin:18px 0 0;transition:opacity .3s ease}
  .chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}
  .chips span{border:1px solid #27413a;color:#d4d4d8;padding:7px 12px;font-size:13px}
  .phone{position:absolute;right:120px;top:50%;width:${Math.round(w * scale) + 20}px;height:${Math.round(h * scale) + 20}px;
    transform:translateY(-50%);border:2px solid #2a2a30;border-radius:38px;background:#000;box-shadow:0 30px 80px rgba(0,0,0,.7),0 0 0 6px #0d0d10}
  .screen{position:absolute;left:10px;top:10px;width:${Math.round(w * scale)}px;height:${Math.round(h * scale)}px;overflow:hidden;border-radius:28px}
  iframe{width:${w}px;height:${h}px;border:0;transform:scale(${scale});transform-origin:0 0;background:#000}
  .fade{opacity:0}
  </style></head><body>
  <div class="left"><div class="k" id="k">Phone companion</div><h1 id="t"></h1><p id="s"></p><div class="chips" id="c"></div></div>
  <div class="phone"><div class="screen"><iframe id="phone" src="${src}"></iframe></div></div>
  <script>
    window.say = (k, t, s, chips) => {
      for (const id of ["t", "s"]) document.getElementById(id).classList.add("fade");
      setTimeout(() => {
        document.getElementById("k").textContent = k;
        document.getElementById("t").textContent = t;
        document.getElementById("s").textContent = s || "";
        document.getElementById("c").innerHTML = (chips || []).map((c) => "<span>" + c + "</span>").join("");
        for (const id of ["t", "s"]) document.getElementById(id).classList.remove("fade");
      }, 280);
    };
    addEventListener("DOMContentLoaded", () => window.__demo && window.__demo.trackFrame(document.getElementById("phone"), ${scale}));
  </script></body></html>`;
}
