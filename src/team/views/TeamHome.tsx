// Team home: workspaces on this device, create or join one, and hosting for teammates.
// Team data lives in its own files and never mixes with the personal planner.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IS_TAURI } from "../../lib/api";
import { team, useWorkspaces, type Hosting } from "../api";
import { ago, Field, inputCls } from "./ui";

export default function TeamHome() {
  const nav = useNavigate();
  const { list, reload } = useWorkspaces();
  const [hosting, setHosting] = useState<Hosting | null>(null);
  const [mode, setMode] = useState<"" | "create" | "join">("");
  const [name, setName] = useState("");
  const [me, setMe] = useState(() => localStorage.getItem("mizan.team.name") ?? "");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { team.hosting().then(setHosting).catch(() => setHosting(null)); }, []);
  useEffect(() => {
    // Invite links opened from outside (deep link / paste) arrive as ?join=…
    const q = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const j = q.get("join");
    if (j) { setMode("join"); setLink(j); }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!me.trim()) { setError("Enter your name as teammates will see it."); return; }
    localStorage.setItem("mizan.team.name", me.trim());
    setBusy(true);
    try {
      if (mode === "create") {
        if (!name.trim()) throw new Error("Name the workspace.");
        const ws = await team.create(name.trim(), me.trim());
        if (hosting && !hosting.enabled) setHosting(await team.hosting(true));
        await reload();
        nav(`/team/${ws.id}/settings`);
      } else {
        if (!link.trim().startsWith("mizan-team://")) throw new Error("Paste the whole invite link. It starts with mizan-team://");
        const ws = await team.join(link.trim(), me.trim());
        await reload();
        nav(`/team/${ws.id}/board`);
      }
    } catch (err) {
      setError(String(err).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  };

  const toggleHosting = async () => {
    try { setHosting(await team.hosting(!hosting?.enabled)); } catch (e) { setError(String(e)); }
  };
  const hosted = (list ?? []).some((w) => w.mode === "host");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="hd text-xl">Team</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-dim">
          Shared projects, sprints and issues with your team, synced over your own network. No cloud account.
          Team workspaces are separate from your personal planner: nothing personal is shared unless you copy it in.
        </p>
      </header>

      <section aria-label="Workspaces" className="grid gap-3 sm:grid-cols-2">
        {list === null && <p role="status">Loading…</p>}
        {list?.map((w) => (
          <Link key={w.id} to={`/team/${w.id}/board`} className="block border border-edge bg-panel p-4 hover:border-accent">
            <div className="flex items-center gap-2">
              <span className="font-bold">{w.name}</span>
              <span className="ml-auto text-xs text-ink-dim">{w.role}</span>
            </div>
            <p className="mt-1 text-xs text-ink-dim">
              {w.mode === "host" ? "Hosted on this computer" : w.mode === "broken" ? "Cannot be opened" : w.error ? `Offline · ${w.error}` : w.last_sync ? `Synced ${ago(w.last_sync)}` : "Waiting for the host"}
              {w.pending > 0 && ` · ${w.pending} to send`}
            </p>
          </Link>
        ))}
        {list?.length === 0 && <p className="text-sm text-ink-dim sm:col-span-2">No workspaces yet. Create one and invite your team, or join with an invite link.</p>}
      </section>

      <div className="flex flex-wrap gap-2">
        <button className={`border px-4 py-2 text-sm ${mode === "create" ? "border-accent text-accent" : "border-edge"}`} onClick={() => setMode(mode === "create" ? "" : "create")}>Create a workspace</button>
        <button className={`border px-4 py-2 text-sm ${mode === "join" ? "border-accent text-accent" : "border-edge"}`} onClick={() => setMode(mode === "join" ? "" : "join")}>Join with an invite</button>
      </div>

      {mode && (
        <form onSubmit={submit} className="space-y-3 border border-edge bg-panel p-4">
          <Field label="Your name (what teammates see)"><input className={inputCls} value={me} maxLength={80} onChange={(e) => setMe(e.target.value)} /></Field>
          {mode === "create" ? (
            <Field label="Workspace name"><input className={inputCls} placeholder="Acme Studio" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
          ) : (
            <Field label="Invite link"><textarea className={`${inputCls} h-20 text-xs`} placeholder="mizan-team://join?ws=…" value={link} onChange={(e) => setLink(e.target.value)} /></Field>
          )}
          {mode === "create" && <p className="text-xs text-ink-dim">This computer becomes the host: it keeps the workspace and teammates sync with it when it is on and reachable. Keep it backed up (Settings → Export).</p>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button disabled={busy} className="btn-px bg-accent px-4 py-2 text-sm font-semibold text-black">{busy ? "Working…" : mode === "create" ? "Create" : "Join"}</button>
        </form>
      )}
      {!mode && error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {hosting && (
        <section className="space-y-2 border border-edge bg-panel p-4 text-sm">
          <div className="flex items-center gap-3">
            <h2 className="font-bold">Hosting</h2>
            <span className={`h-2 w-2 rounded-full ${hosting.running ? "bg-accent" : "bg-edge"}`} />
            <span className="text-ink-dim">{hosting.running ? `Teammates can reach this computer on port ${hosting.port}` : "Off"}</span>
            <button className="ml-auto border border-edge px-3 py-1 text-xs hover:border-accent" onClick={toggleHosting}>{hosting.enabled ? "Turn off" : "Turn on"}</button>
          </div>
          {hosting.running && <p className="text-xs text-ink-dim">Addresses: {hosting.addresses.join(", ") || "no network found"}. Teammates must be on the same Wi-Fi, hotspot or VPN (for example Tailscale). Allow port {hosting.port} in your firewall if they cannot connect.</p>}
          {hosting.error && <p role="alert" className="text-xs text-danger">{hosting.error}</p>}
          {hosted && !hosting.enabled && <p className="text-xs text-gold">You host a workspace but hosting is off, so teammates cannot sync.</p>}
          {!IS_TAURI && <p className="text-xs text-ink-dim">Browser preview: a demo workspace runs in memory. Install the desktop app to host or join real ones.</p>}
        </section>
      )}
    </div>
  );
}
