// Mizan Guard on YouTube: intention gate + feed/Shorts suppression.
// YouTube is a single-page app: URL changes rarely cause a page load, so everything
// here re-evaluates on yt-navigate events, not just at document_start.

const SESSION_KEY = "mizan-intent"; // sessionStorage: user stated an intention this tab session

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  Object.assign(e, attrs || {});
  (children || []).forEach((c) => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return e;
}

// ---------- Shorts: blocked ALWAYS, including SPA navigation ----------

function killShorts() {
  if (/^\/shorts(\/|$)/.test(location.pathname)) {
    // Client-side redirect; webRequest can't see SPA navigations.
    location.replace("https://www.youtube.com/results?search_query=" + encodeURIComponent(lastIntent() || ""));
    return true;
  }
  return false;
}

// ---------- Intention gate ----------

function lastIntent() {
  return sessionStorage.getItem(SESSION_KEY) || "";
}

function removeGate() {
  document.getElementById("mizan-gate")?.remove();
}

function planList(plan) {
  // Today's calendar blocks from the Mizan planner: the current one is highlighted.
  const upcoming = plan.filter((b) => !b.past).slice(0, 5);
  if (!upcoming.length) return null;
  return el(
    "ul",
    { className: "mizan-plan" },
    upcoming.map((b) =>
      el("li", { className: b.now ? "mizan-now" : "" }, [
        el("span", { className: "mizan-time" }, [`${b.start}–${b.end}`]),
        (b.now ? "▶ " : "") + b.title,
      ]),
    ),
  );
}

function showGate(tasks, plan) {
  if (document.getElementById("mizan-gate")) return;
  const planEl = planList(plan || []);
  const list = el(
    "ul",
    { className: "mizan-tasks" },
    tasks.length ? tasks.slice(0, 6).map((t) => el("li", {}, [t])) : [el("li", {}, ["No open tasks. Why are you here?"])],
  );
  const input = el("input", {
    className: "mizan-input",
    placeholder: "What exactly are you here to search? (min 10 characters)",
  });
  const btn = el("button", { className: "mizan-btn" }, ["Search with intention"]);
  const leave = el("button", { className: "mizan-btn mizan-btn-ghost" }, ["Leave YouTube"]);
  const gate = el("div", { id: "mizan-gate" }, [
    el("div", { className: "mizan-card" }, [
      el("h1", {}, ["Stop. What is the task?"]),
      ...(planEl ? [el("p", { className: "mizan-sub" }, ["Your plan for today:"]), planEl] : []),
      el("p", { className: "mizan-sub" }, ["Your open tasks right now:"]),
      list,
      input,
      el("div", { className: "mizan-row" }, [btn, leave]),
      el("p", { className: "mizan-foot" }, [
        "Shorts are blocked. The feed is hidden. Consumption is logged against build time.",
      ]),
    ]),
  ]);

  const go = () => {
    const q = input.value.trim();
    if (q.length < 10) {
      input.classList.add("mizan-bad");
      input.placeholder = "Minimum 10 characters. Be specific.";
      return;
    }
    sessionStorage.setItem(SESSION_KEY, q);
    removeGate();
    location.href = "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
  };
  btn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => e.key === "Enter" && go());
  leave.addEventListener("click", () => {
    location.href = "https://duckduckgo.com";
  });

  (document.body || document.documentElement).appendChild(gate);
  setTimeout(() => input.focus(), 50);
}

// ---------- Feed / Shorts-shelf suppression (CSS, permanent) ----------

function suppressFeed() {
  if (document.getElementById("mizan-style")) return;
  const style = el("style", {
    id: "mizan-style",
    textContent: `
      ytd-rich-grid-renderer, ytd-browse[page-subtype="home"] #contents,
      ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts],
      ytd-rich-section-renderer:has(ytd-rich-shelf-renderer),
      a[title="Shorts"], ytd-guide-entry-renderer:has(a[title="Shorts"]),
      ytd-mini-guide-entry-renderer[aria-label="Shorts"],
      #related ytd-reel-shelf-renderer { display: none !important; }
    `,
  });
  document.documentElement.appendChild(style);
}

// ---------- Per-navigation evaluation ----------

let cachedTasks = [];
let cachedPlan = [];

function evaluate() {
  suppressFeed();
  if (killShorts()) return;
  const p = location.pathname;
  const allowed =
    lastIntent() &&
    (p === "/results" || p === "/watch" || p.startsWith("/@") || p.startsWith("/channel") || p.startsWith("/playlist"));
  if (allowed) {
    removeGate();
  } else {
    showGate(cachedTasks, cachedPlan);
  }
}

async function init() {
  try {
    const state = await browser.runtime.sendMessage({ cmd: "getState" });
    cachedTasks = (state && state.tasks) || [];
    cachedPlan = (state && state.plan) || [];
  } catch {
    /* background not ready; gate still shows without tasks */
  }
  const run = () => evaluate();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
  // SPA navigation hooks: YouTube fires yt-navigate-finish; popstate covers back/forward.
  window.addEventListener("yt-navigate-finish", run, true);
  window.addEventListener("yt-navigate-start", () => killShorts(), true);
  window.addEventListener("popstate", run);
  // Belt and suspenders: some navigations slip both hooks.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      run();
    }
  }, 800);
}

init();
