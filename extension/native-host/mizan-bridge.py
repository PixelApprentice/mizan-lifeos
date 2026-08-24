#!/usr/bin/env python3
"""mizan-bridge — Firefox native-messaging host.

Serves the Mizan focus state (from ~/.local/state/mizan/focus.json), open tasks, and
today's planned calendar blocks (from the app's SQLite DB) to the Mizan Guard extension.
Stdlib only.
Protocol: 4-byte little-endian length prefix + JSON, both directions.
"""
import json
import sqlite3
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
STATE = HOME / ".local/state/mizan/focus.json"
# tauri-plugin-sql keeps the DB in the app *config* dir; older builds used the data dir.
DB_CANDIDATES = [
    HOME / ".config/com.salahudin.mizan/mizan.db",
    HOME / ".local/share/com.salahudin.mizan/mizan.db",
]


def db_path():
    for p in DB_CANDIDATES:
        if p.exists():
            return p
    return DB_CANDIDATES[0]


def read_msg():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        sys.exit(0)
    (length,) = struct.unpack("<I", raw)
    return json.loads(sys.stdin.buffer.read(length))


def send_msg(obj):
    data = json.dumps(obj).encode()
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def focus_state():
    try:
        s = json.loads(STATE.read_text())
        ends = datetime.fromisoformat(s["ends_at"])
        running = bool(s.get("paused_at")) or datetime.now(timezone.utc) < ends.astimezone(timezone.utc)
        active = running and not s.get("broken_at")
        return {"active": active, "sites": s.get("sites", [])}
    except Exception:
        return {"active": False, "sites": []}


def open_tasks():
    try:
        con = sqlite3.connect(f"file:{db_path()}?mode=ro", uri=True)
        rows = con.execute(
            "SELECT title FROM tasks WHERE status != 'done' ORDER BY parent_id IS NULL DESC, created_at DESC LIMIT 8"
        ).fetchall()
        con.close()
        return [r[0] for r in rows]
    except Exception:
        return []


def parse_local(s):
    """Events are stored either as UTC ISO ("...Z") or naive local time."""
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d.astimezone()  # naive values are taken as local time


def today_plan():
    """Today's calendar blocks, in order, as {title, start, end, now} (12-hour times)."""
    try:
        con = sqlite3.connect(f"file:{db_path()}?mode=ro", uri=True)
        rows = con.execute("SELECT title, start, end FROM events").fetchall()
        con.close()
    except Exception:
        return []
    now = datetime.now().astimezone()
    out = []
    for title, start, end in rows:
        try:
            s, e = parse_local(start), parse_local(end)
        except Exception:
            continue
        if s.date() != now.date():
            continue
        out.append((s, e, title))
    out.sort()
    fmt = lambda d: d.strftime("%I:%M %p").lstrip("0")
    return [{"title": t, "start": fmt(s), "end": fmt(e), "now": s <= now < e, "past": e <= now}
            for s, e, t in out]


def main():
    while True:
        msg = read_msg()
        if msg.get("cmd") == "status":
            resp = focus_state()
            resp["tasks"] = open_tasks()
            resp["plan"] = today_plan()
            send_msg(resp)
        else:
            send_msg({"error": "unknown command"})


if __name__ == "__main__":
    main()
