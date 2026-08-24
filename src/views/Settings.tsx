import { useEffect, useState } from "react";
import { getSetting, setSetting, permBlockApply, permBlockClear, getLifeosConfig, setLifeosStart } from "../lib/api";
import { DEFAULT_WINDOWS, parseWindows } from "../lib/plan";

const STEVENBLACK_PORN = "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn-only/hosts";

const FIELDS: { key: string; label: string; hint: string; rows?: number }[] = [
  {
    key: "blocked_sites",
    label: "blocked sites",
    hint: "comma-separated domains, hosts-blocked in deep mode · youtube is handled by the extension",
    rows: 3,
  },
  {
    key: "blocked_apps",
    label: "blocked apps",
    hint: "hyprland window-class substrings · find one with: hyprctl clients | grep class",
  },
  { key: "focus_presets", label: "focus presets", hint: "comma-separated minutes shown as buttons, e.g. 25,50,90" },
  { key: "disc_path", label: "Local data folder", hint: "Your tracker, logs and Day 1 stay outside the source repository. Leave empty for ~/Documents/lifeos." },
  { key: "prayer_city", label: "Prayer city (optional)", hint: "Entering a city and country enables requests to AlAdhan. Only this location is sent; tasks and logs stay local." },
  { key: "prayer_country", label: "Prayer country (optional)", hint: "Leave both location fields empty to disable online prayer times." },
  {
    key: "overlay_mode",
    label: "corner mini-timer",
    hint: "auto = only when waybar is hidden · always · never — the waybar module shows the timer otherwise",
  },
  {
    key: "plan_windows_weekday",
    label: "auto-plan windows · mon–thu",
    hint: `when tasks may be auto-planned · HH:MM-HH:MM, comma-separated · default ${DEFAULT_WINDOWS.weekday}`,
  },
  {
    key: "plan_windows_friday",
    label: "auto-plan windows · friday",
    hint: `default ${DEFAULT_WINDOWS.friday}`,
  },
  {
    key: "plan_windows_weekend",
    label: "auto-plan windows · sat–sun",
    hint: `default ${DEFAULT_WINDOWS.weekend}`,
  },
];

const GROUPS = [
  { title: "Scheduling", keys: ["plan_windows_weekday", "plan_windows_friday", "plan_windows_weekend"] },
  { title: "Focus & blocking", keys: ["focus_presets", "overlay_mode", "blocked_sites", "blocked_apps"] },
  { title: "Local storage", keys: ["disc_path"] },
  { title: "Prayer times (optional)", keys: ["prayer_city", "prayer_country"] },
];

export default function Settings() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");
  const [permMsg, setPermMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [permBusy, setPermBusy] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [activeStart, setActiveStart] = useState("");
  const [startBusy, setStartBusy] = useState(false);
  const [startMessage, setStartMessage] = useState("");

  useEffect(() => {
    Promise.all([...FIELDS.map((f) => getSetting(f.key)), getSetting("perm_extra"), getSetting("perm_status")]).then(
      (vs) => {
        const o: Record<string, string> = {};
        FIELDS.forEach((f, i) => (o[f.key] = vs[i]));
        o.perm_extra = vs[FIELDS.length];
        o.perm_status = vs[FIELDS.length + 1];
        o.focus_presets ||= "25,50,90";
        setValues(o);
        setLoaded(true);
      },
    ).catch((e) => setError(`Could not load settings: ${String(e)}`));
    getLifeosConfig().then((config) => {
      setStartDate(config.start_date);
      setActiveStart(config.start_date);
    }).catch((e) => setError(`Could not load Day 1: ${String(e)}`));
  }, []);

  const save = async () => {
    setError("");
    setSaved("");
    const presets = (values.focus_presets ?? "").split(",").map(Number);
    if (presets.some((n) => !Number.isInteger(n) || n < 5 || n > 480)) {
      setError("Focus presets must be whole minutes from 5 to 480, separated by commas.");
      return;
    }
    if (values.disc_path && !values.disc_path.startsWith("/")) {
      setError("Use an absolute local data folder path.");
      return;
    }
    if (!!values.prayer_city?.trim() !== !!values.prayer_country?.trim()) {
      setError("Enter both a prayer city and country, or leave both empty.");
      return;
    }
    setBusy(true);
    try {
      for (const key of ["plan_windows_weekday", "plan_windows_friday", "plan_windows_weekend"]) {
        if (values[key]?.trim()) parseWindows(values[key]);
      }
      for (const f of FIELDS) await setSetting(f.key, values[f.key] ?? "");
      const config = await getLifeosConfig();
      setStartDate(config.start_date);
      setActiveStart(config.start_date);
      setSaved("Settings saved on this device.");
    } catch (e) {
      setError(`Some settings may not have saved: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h2 className="cursor font-bold">settings</h2>
        <p className="mt-1 text-sm text-ink-dim">nothing here is fixed — the app follows these, not the other way</p>
      </header>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!loaded && !error && <p role="status">Loading settings...</p>}
      <section className="panel space-y-3 p-4">
        <h3 className="font-bold">Your LifeOS timeline</h3>
        <p className="text-sm text-ink-dim">Choose Day 1 once, then keep going. There is no final day and no automatic cycle reset. Changing this date preserves your existing logs and records.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Day 1
            <input type="date" aria-label="LifeOS Day 1" value={startDate} disabled={startBusy || busy || !activeStart}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-2 block border border-edge bg-panel-2 p-2" />
          </label>
          <button disabled={startBusy || busy || !activeStart || startDate === activeStart}
            onClick={async () => {
              setStartBusy(true);
              setStartMessage("");
              setError("");
              try {
                const config = await setLifeosStart(startDate);
                setStartDate(config.start_date);
                setActiveStart(config.start_date);
                setStartMessage(`Day 1 saved as ${config.start_date}. Historical records were kept.`);
              } catch (e) {
                setError(`Could not change Day 1: ${String(e)}`);
              } finally {
                setStartBusy(false);
              }
            }} className="btn-px bg-accent px-4 py-2 text-sm font-bold text-black">
            {startBusy ? "Saving..." : "Set Day 1"}
          </button>
        </div>
        <p role="status" className="text-xs text-accent">{startMessage || (activeStart ? `Current Day 1: ${activeStart}` : "Loading timeline...")}</p>
      </section>
      <fieldset disabled={!loaded || busy} className="space-y-3">
        {GROUPS.map((group, index) => <details key={group.title} open={index === 0} className="panel p-4">
          <summary className="font-bold">{group.title}</summary>
          <div className="space-y-5 pt-4">
        {FIELDS.filter((f) => group.keys.includes(f.key)).map((f) => (
          <label key={f.key} className="block">
            <div className="hd">{f.label}</div>
            <p className="mt-2 text-[11px] text-ink-dim">{f.hint}</p>
            {f.key === "overlay_mode" ? (
              <select value={values[f.key] || "auto"} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className="mt-2 w-full border border-edge bg-panel p-3 text-sm">
                <option value="auto">Automatic - when Waybar is hidden</option>
                <option value="always">Always show</option>
                <option value="never">Never show</option>
              </select>
            ) : f.rows ? (
              <textarea
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                rows={f.rows}
                className="mt-2 w-full border border-edge bg-panel p-3 text-sm outline-none focus:border-accent"
              />
            ) : (
              <input
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="mt-2 w-full border border-edge bg-panel p-3 text-sm outline-none focus:border-accent"
              />
            )}
          </label>
        ))}
          </div>
        </details>)}
      </fieldset>

      <div className="flex items-center gap-4">
        <button disabled={!loaded || busy || startBusy} onClick={save} className="btn-px bg-accent px-5 py-2.5 text-sm font-bold text-black">
          {busy ? "Saving..." : "Save settings"}
        </button>
        <span role="status" className="text-xs text-accent">{saved}</span>
      </div>

      <details className="panel space-y-4 p-5">
        <summary className="font-bold">Advanced: permanent site shield</summary>
        <p className="text-[11px] leading-relaxed text-ink-dim">
          permanently blocked in /etc/hosts — independent of deep mode, survives reboots, needs your
          password once to apply. import a maintained adult-content list (StevenBlack, open source)
          and add your own domains below. removing it also needs the password — friction by design.
        </p>
        <textarea
          aria-label="Permanently blocked domains"
          value={values.perm_extra ?? ""}
          onChange={(e) => setValues((v) => ({ ...v, perm_extra: e.target.value }))}
          rows={3}
          placeholder="your own always-blocked domains, comma or newline separated…"
          className="w-full border border-edge bg-panel-2 p-3 text-sm outline-none focus:border-accent"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={permBusy || !loaded}
            onClick={async () => {
              setPermBusy(true);
              setPermMsg("downloading + applying… (needs password)");
              try {
                const extra = (values.perm_extra ?? "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
                const n = await permBlockApply(extra, STEVENBLACK_PORN);
                await setSetting("perm_extra", values.perm_extra ?? "");
                await setSetting("perm_status", `${n} domains · ${new Date().toISOString().slice(0, 10)}`);
                setPermMsg(`applied: ${n} domains blocked`);
              } catch (e) {
                setPermMsg(String(e));
              } finally {
                setPermBusy(false);
              }
            }}
            className="btn-px bg-accent px-4 py-2 text-xs font-bold text-black"
          >
            import adult-list + apply
          </button>
          <button
            disabled={permBusy || !loaded}
            onClick={async () => {
              setPermBusy(true);
              setPermMsg("applying your list… (needs password)");
              try {
                const extra = (values.perm_extra ?? "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
                const n = await permBlockApply(extra, null);
                await setSetting("perm_extra", values.perm_extra ?? "");
                await setSetting("perm_status", `${n} domains · ${new Date().toISOString().slice(0, 10)}`);
                setPermMsg(`applied: ${n} domains blocked`);
              } catch (e) {
                setPermMsg(String(e));
              } finally {
                setPermBusy(false);
              }
            }}
            className="border border-edge px-4 py-2 text-xs text-ink-dim hover:text-ink"
          >
            apply my list only
          </button>
          <button
            disabled={permBusy || !loaded}
            onClick={async () => {
              setPermBusy(true);
              try {
                await permBlockClear();
                await setSetting("perm_status", "");
                setPermMsg("Permanent block removed.");
              } catch (e) {
                setPermMsg(String(e));
              } finally {
                setPermBusy(false);
              }
            }}
            className="border border-danger/40 px-4 py-2 text-xs text-danger hover:bg-danger/10"
          >
            remove
          </button>
          <span role="status" className="text-xs text-ink">{permMsg || values.perm_status}</span>
        </div>
      </details>

      <details className="panel p-5 text-xs leading-relaxed text-ink-dim">
        <summary className="mb-3 font-bold">Advanced: one-time system setup</summary>
        <pre className="whitespace-pre-wrap">{`sudo pacman -S --needed webkit2gtk-4.1
sudo install -o root -g root -m 755 helper/mizan-hosts /usr/local/bin/mizan-hosts
sudo install -o root -g root -m 644 helper/com.salahudin.mizan.hostsblock.policy /usr/share/polkit-1/actions/
bash extension/native-host/install.sh
pnpm tauri build --no-bundle && bash scripts/install-desktop.sh   # launcher icon, no terminal needed
# firefox → about:debugging → load temporary add-on → extension/manifest.json
# recommended alongside: uBlock Origin from addons.mozilla.org (don't reinvent ad blocking)`}</pre>
      </details>
    </div>
  );
}
