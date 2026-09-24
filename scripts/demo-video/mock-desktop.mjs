// A stand-in for the desktop's phone-companion server, so the real phone page
// (companion/index.html) can be filmed without running the Tauri app.
// It speaks the same small API: ping, hello, focus, sync.

import http from "node:http";
import { readFileSync } from "node:fs";

export const TOKEN = "d".repeat(32);
export const DESKTOP_ID = "demodesk0001";

const iso = (ms) => new Date(ms).toISOString();

function seed() {
  const now = Date.now();
  const stamp = iso(now - 60_000);
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const project = { sync_id: "proj-essay", name: "Semester essay", goal: "Hand it in by Friday", color: "#34d399", due: null, status: "active", updated_at: stamp };
  const task = (sync_id, title, status, extra = {}) => ({
    sync_id, title, notes: "", kind: "code", status, est_min: 25, due: null, priority: 2, position: 1024,
    completed_at: status === "done" ? stamp : null, created_at: stamp, parent_sync: null, project_sync: "proj-essay", updated_at: stamp, ...extra,
  });
  return {
    projects: [project],
    tasks: [
      task("t-draft", "Write the essay draft", "doing", { priority: 1, est_min: 50 }),
      task("t-draft-1", "Outline the sections", "done", { parent_sync: "t-draft", est_min: 10 }),
      task("t-draft-2", "Write the intro", "open", { parent_sync: "t-draft", est_min: 20, position: 2048 }),
      task("t-draft-3", "Add sources", "open", { parent_sync: "t-draft", est_min: 20, position: 3072 }),
      task("t-dentist", "Book the dentist", "open", { est_min: 15, kind: "other" }),
      task("t-review", "Review this week's notes", "backlog", { kind: "study" }),
    ],
    events: [
      { sync_id: "e-1", title: "Deep work: essay", start: at(9, 0), end: at(10, 30), task_sync: "t-draft", color: "#34d399", done: 0, updated_at: stamp },
      { sync_id: "e-2", title: "Walk + prayer", start: at(12, 30), end: at(13, 0), task_sync: null, color: "#eab308", done: 0, updated_at: stamp },
      { sync_id: "e-3", title: "Study group", start: at(15, 0), end: at(16, 0), task_sync: null, color: "#60a5fa", done: 0, updated_at: stamp },
    ],
  };
}

export function startMockDesktop({ port, pagePath, stageHtml }) {
  const page = readFileSync(pagePath, "utf8");
  const data = seed();
  let focus = null;
  const received = [];

  const send = (res, code, body, type = "application/json") => {
    res.writeHead(code, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, x-mizan-token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const body = raw ? JSON.parse(raw) : {};
      const now = iso(Date.now());
      if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
      if (url.pathname === "/" || url.pathname === "/index.html") return send(res, 200, page, "text/html; charset=utf-8");
      if (url.pathname === "/stage") return send(res, 200, stageHtml, "text/html; charset=utf-8");
      if (url.pathname === "/api/ping") return send(res, 200, { app: "mizan", id: DESKTOP_ID });
      if (req.headers["x-mizan-token"] !== TOKEN && url.searchParams.get("token") !== TOKEN) return send(res, 401, { error: "Pairing code out of date." });
      switch (url.pathname) {
        case "/api/hello":
          return send(res, 200, { app: "mizan", host: "workstation", now, id: DESKTOP_ID, port, addresses: ["192.168.1.20"] });
        case "/api/focus":
          return send(res, 200, { now, state: focus });
        case "/api/focus/start": {
          const start = Date.now();
          focus = { started_at: iso(start), ends_at: iso(start + body.minutes * 60_000), planned_min: body.minutes, sites: [], apps: [],
            kills: 0, intent: body.intent || null, disc: null, paused_at: null, broken_at: null, broken_reason: null, phone_leaves: 0 };
          return send(res, 200, { now, state: focus });
        }
        case "/api/focus/pause":
          if (focus?.paused_at) {
            focus.ends_at = iso(Date.parse(focus.ends_at) + (Date.now() - Date.parse(focus.paused_at)));
            focus.paused_at = null;
          } else if (focus) focus.paused_at = now;
          return send(res, 200, { now, state: focus });
        case "/api/focus/end":
          focus = null;
          return send(res, 200, { now, state: null });
        case "/api/focus/phone-left":
          if (focus) focus.phone_leaves = (focus.phone_leaves || 0) + 1;
          return send(res, 200, { phone_leaves: focus?.phone_leaves || 0 });
        case "/api/sync":
          for (const t of body.tasks || []) {
            received.push(t.title);
            const i = data.tasks.findIndex((x) => x.sync_id === t.sync_id);
            if (i >= 0) data.tasks[i] = t; else data.tasks.push(t);
          }
          return send(res, 200, { now, ...data, deletions: [], applied: (body.tasks || []).length, rejected: 0 });
        default:
          return send(res, 404, { error: "Not found." });
      }
    });
  });

  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({
    received,
    close: () => new Promise((done) => server.close(done)),
  })));
}
