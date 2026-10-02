// Team commands: Tauri invoke on desktop, the in-memory demo host in a plain browser.
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "../lib/api";
import { changed as demoChanged, demoTeam } from "./demo";
import { buildModel, newId, type Model, type OpInput, type TeamState, type WorkspaceSummary } from "./model";

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!IS_TAURI) return demoTeam(cmd, args) as T;
  return tauriInvoke<T>(cmd, args);
}

export interface Hosting { enabled: boolean; running: boolean; port: number; addresses: string[]; error: string | null }
export interface Invite { link: string; qr_svg: string; role: string; expires_in_days: number }
export interface MyIssue { ws: string; ws_name: string; id: string; key: string; title: string; status: string; priority: number; due: string | null; estimate: number | null }
export interface SubmitResult { accepted?: { op_id: string }[]; rejected?: { op_id: string; reason: string }[]; queued?: number }

export const team = {
  list: () => call<WorkspaceSummary[]>("team_list"),
  create: (name: string, ownerName: string) => call<WorkspaceSummary>("team_create", { name, ownerName }),
  state: (ws: string) => call<TeamState>("team_state", { ws }),
  submit: (ws: string, ops: OpInput[]) => call<SubmitResult>("team_submit", { ws, ops }),
  sync: (ws: string) => call<WorkspaceSummary>("team_sync", { ws }),
  hosting: (enabled?: boolean, port?: number) => call<Hosting>("team_hosting", { enabled, port }),
  invite: (ws: string, role: string) => call<Invite>("team_invite", { ws, role }),
  join: (invite: string, name: string) => call<WorkspaceSummary>("team_join", { invite, name }),
  remove: (ws: string) => call<void>("team_remove", { ws }),
  exportJson: (ws: string) => call<string>("team_export", { ws }),
  myIssues: () => call<MyIssue[]>("team_my_issues"),
};

/** Apply edits and throw the host's first reason if it refused any. */
export async function edit(ws: string, ops: OpInput[]): Promise<void> {
  const result = await team.submit(ws, ops);
  const rejected = result.rejected ?? [];
  if (rejected.length) throw new Error(rejected[0].reason || "The host refused this change.");
}

export const create = (entity: string, fields: Record<string, unknown>, id = newId()): OpInput => ({ entity, id, kind: "create", fields });
export const set = (entity: string, id: string, fields: Record<string, unknown>): OpInput => ({ entity, id, kind: "set", fields });
export const remove = (entity: string, id: string): OpInput => ({ entity, id, kind: "delete", fields: {} });

/** Calls `fn` with the workspace id whenever team data changes (local edit or sync). */
export function onTeamChanged(fn: (ws: string) => void): () => void {
  if (!IS_TAURI) {
    const h = (e: Event) => fn(String((e as CustomEvent).detail));
    demoChanged.addEventListener("changed", h);
    return () => demoChanged.removeEventListener("changed", h);
  }
  let stop: (() => void) | undefined;
  let dead = false;
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen<{ ws: string }>("team://changed", (e) => fn(e.payload?.ws ?? "")).then((u) => (dead ? u() : (stop = u))),
  );
  return () => { dead = true; stop?.(); };
}

/** Live model of one workspace. */
export function useWorkspace(ws: string | undefined) {
  const [state, setState] = useState<TeamState | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!ws) return;
    try { setState(await team.state(ws)); setError(""); } catch (e) { setError(String(e)); }
  }, [ws]);
  useEffect(() => {
    setState(null);
    void load();
    let timer = 0;
    const off = onTeamChanged((changedWs) => {
      if (changedWs && changedWs !== ws) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 60);
    });
    return () => { off(); window.clearTimeout(timer); };
  }, [ws, load]);
  const model: Model | null = useMemo(() => (state ? buildModel(state) : null), [state]);
  return { model, error, reload: load };
}

/** Workspace list, refreshed on any team change. */
export function useWorkspaces() {
  const [list, setList] = useState<WorkspaceSummary[] | null>(null);
  const load = useCallback(() => team.list().then(setList).catch(() => setList([])), []);
  useEffect(() => {
    void load();
    return onTeamChanged(() => void load());
  }, [load]);
  return { list, reload: load };
}
