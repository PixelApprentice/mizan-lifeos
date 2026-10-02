// Appearance: dark (the original OLED look), light, or follow the system setting.
export type ThemePref = "system" | "dark" | "light";
const KEY = "mizan.theme";
const media = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null);

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "dark";
  } catch {
    return "dark";
  }
}

export const resolveTheme = (pref: ThemePref): "dark" | "light" =>
  pref === "system" ? (media()?.matches ? "light" : "dark") : pref;

function apply() {
  const theme = resolveTheme(themePref());
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f5f5f7" : "#000000");
}

export function setThemePref(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* storage unavailable: still apply for this session */ }
  apply();
  window.dispatchEvent(new CustomEvent("mizan:theme", { detail: pref }));
}

export function cycleTheme(): ThemePref {
  const next: ThemePref = resolveTheme(themePref()) === "dark" ? "light" : "dark";
  setThemePref(next);
  return next;
}

/** Call once before the first render, so the app never flashes the wrong theme. */
export function initTheme() {
  apply();
  media()?.addEventListener("change", () => { if (themePref() === "system") apply(); });
  window.addEventListener("storage", (e) => { if (e.key === KEY) apply(); });
}
