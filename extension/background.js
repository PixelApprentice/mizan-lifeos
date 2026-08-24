// Mizan Guard background: polls the native host for focus state + today's tasks,
// blocks distraction sites during deep mode, always blocks YouTube Shorts.

const NATIVE = "mizan_bridge";
let state = { active: false, sites: [], tasks: [], plan: [] };

function refresh() {
  try {
    browser.runtime.sendNativeMessage(NATIVE, { cmd: "status" }).then(
      (resp) => {
        state = {
          active: !!resp.active,
          sites: resp.sites || [],
          tasks: resp.tasks || [],
          plan: resp.plan || [],
        };
        browser.storage.local.set({ mizan: state });
      },
      () => {
        // Native host unreachable (app not installed / bridge missing): fail open for
        // sites, keep Shorts blocked, keep last known tasks.
        state.active = false;
        browser.storage.local.set({ mizan: state });
      },
    );
  } catch (e) {
    /* ignore */
  }
}
refresh();
setInterval(refresh, 15000);

function hostBlocked(url) {
  if (!state.active) return false;
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return state.sites.some((s) => h === s.replace(/^www\./, "") || h.endsWith("." + s.replace(/^www\./, "")));
  } catch {
    return false;
  }
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    // Shorts are blocked always, deep mode or not.
    if (/youtube\.com\/shorts(\/|$|\?)/.test(url)) {
      return { redirectUrl: "https://www.youtube.com/?mizan=shorts-blocked" };
    }
    if (hostBlocked(url)) {
      return { redirectUrl: browser.runtime.getURL("blocked.html") };
    }
    return {};
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["blocking"],
);

// Content script asks for tasks/state.
browser.runtime.onMessage.addListener((msg) => {
  if (msg.cmd === "getState") return Promise.resolve(state);
  return false;
});
