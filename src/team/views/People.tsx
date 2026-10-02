// People: members, roles and invites. Invites are single-use links (and QR codes) that
// expire in 7 days; only a hash is kept on the host.
import { useState } from "react";
import { set, team, type Invite } from "../api";
import { can, type Role } from "../model";
import { Avatar, ago, inputCls, inlineCls, useWs } from "./ui";

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including other owners and deleting the workspace.",
  admin: "Manage members, projects, sprints and settings.",
  member: "Create and edit issues, comment, log work.",
  viewer: "Read everything and comment. Cannot edit issues.",
};
const COLORS = ["#6ee7b7", "#93c5fd", "#f9a8d4", "#fcd34d", "#c4b5fd", "#fdba74", "#67e8f9", "#fca5a5"];

export default function People() {
  const { ws, model, run, ask } = useWs();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [myName, setMyName] = useState(model.members.get(model.me)?.name ?? "");
  const admin = can(model, "manage-members");
  const members = [...model.members.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const roles: Role[] = model.role === "owner" ? ["admin", "member", "viewer"] : ["member", "viewer"];

  const makeInvite = async () => {
    setError("");
    setCopied(false);
    try { setInvite(await team.invite(ws, role)); } catch (e) { setError(String(e)); }
  };
  const copy = async () => {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite.link); setCopied(true); } catch { setError("Copy failed. Select the link and copy it by hand."); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className="border border-edge bg-panel">
        <h3 className="border-b border-edge px-4 py-2 font-bold">Members · {members.filter((m) => m.active).length}</h3>
        <ul className="divide-y divide-edge/60">
          {members.map((m) => (
            <li key={m.id} className={`flex flex-wrap items-center gap-3 px-4 py-2 text-sm ${m.active ? "" : "opacity-50"}`}>
              <Avatar model={model} id={m.id} size={26} />
              <span className="flex-1">
                {m.name}{m.id === model.me && <span className="text-ink-dim"> (you)</span>}
                {!m.active && <span className="ml-2 text-xs text-danger">deactivated</span>}
                {m.joined_at && <span className="block text-xs text-ink-dim">joined {ago(m.joined_at)}</span>}
              </span>
              {admin && m.id !== model.me && (m.role !== "owner" || model.role === "owner") ? (
                <select aria-label={`Role of ${m.name}`} className={`${inlineCls} w-28`} value={m.role} onChange={(e) => void run([set("member", m.id, { role: e.target.value })])}>
                  {(model.role === "owner" ? ["owner", "admin", "member", "viewer"] : ["admin", "member", "viewer"]).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : <span className="w-28 text-xs text-ink-dim">{m.role}</span>}
              {admin && m.id !== model.me && (m.role !== "owner" || model.role === "owner") && (
                <button className="border border-edge px-2 py-1 text-xs hover:border-danger" onClick={() => m.active
                  ? ask({ title: `Deactivate ${m.name}?`, body: "Their device stops syncing at once. Their issues, comments and history stay.", confirmLabel: "Deactivate", danger: true, onConfirm: async () => { if (!(await run([set("member", m.id, { active: false })]))) throw new Error("Not changed."); } })
                  : void run([set("member", m.id, { active: true })])}>
                  {m.active ? "Deactivate" : "Reactivate"}
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="border-t border-edge p-4">
          <h4 className="mb-2 text-xs uppercase tracking-widest text-ink-dim">Your profile</h4>
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Your display name" className={`${inlineCls} max-w-56`} value={myName} maxLength={80} onChange={(e) => setMyName(e.target.value)} />
            <button className="border border-edge px-3 py-1.5 text-xs hover:border-accent" disabled={!myName.trim()} onClick={() => void run([set("member", model.me, { name: myName.trim() })])}>Save name</button>
            <span className="flex gap-1" role="group" aria-label="Your colour">
              {COLORS.map((c) => <button key={c} aria-label={`Colour ${c}`} onClick={() => void run([set("member", model.me, { color: c })])} className="h-5 w-5 rounded-full" style={{ background: c, outline: model.members.get(model.me)?.color === c ? "2px solid white" : undefined }} />)}
            </span>
          </div>
        </div>
      </section>
      <section className="space-y-3 border border-edge bg-panel p-4">
        <h3 className="font-bold">Invite someone</h3>
        {!admin ? <p className="text-sm text-ink-dim">Ask an owner or admin for an invite.</p> : (
          <>
            <div className="flex gap-2">
              <select aria-label="Role for the invite" className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button className="btn-px shrink-0 bg-accent px-3 py-1.5 text-sm font-semibold text-black" onClick={makeInvite}>Create invite</button>
            </div>
            <p className="text-xs text-ink-dim">{ROLE_HELP[role]}</p>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            {invite && (
              <div className="space-y-2">
                {invite.qr_svg && <div className="mx-auto w-52 bg-white p-2" aria-label="Invite QR code" role="img" dangerouslySetInnerHTML={{ __html: invite.qr_svg }} />}
                <textarea readOnly aria-label="Invite link" className={`${inputCls} h-20 text-xs`} value={invite.link} onFocus={(e) => e.currentTarget.select()} />
                <button className="w-full border border-edge px-3 py-1.5 text-sm hover:border-accent" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
                <p className="text-xs text-ink-dim">Single use, {invite.role}, expires in {invite.expires_in_days} days. Teammates open it in Mizan → Team → Join, or scan it with the Mizan phone app. They must be on the same network (Wi-Fi, hotspot or VPN).</p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
