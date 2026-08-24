#!/usr/bin/env bash
# mizan-waybar.sh — Waybar custom module bridge for Mizan focus sessions.
#   status        emit one JSON line for waybar (interval mode)
#   toggle-pause  pause/resume the running session (same semantics as the app)
# State lives in ~/.local/state/mizan/focus.json; editing it is safe — the app and its
# watcher re-read the file every tick.
set -eu

case "${1:-status}" in
    status)
        python3 - <<'EOF'
import json, os
from datetime import datetime

p = os.path.expanduser("~/.local/state/mizan/focus.json")
out = {"text": "", "class": "idle", "tooltip": "mizan: no session — open the app to begin"}
try:
    s = json.load(open(p))
    now = datetime.now().astimezone()
    ends = datetime.fromisoformat(s["ends_at"])
    base = datetime.fromisoformat(s["paused_at"]) if s.get("paused_at") else now
    rem = max(0, int((ends - base).total_seconds()))
    mm, ss = divmod(rem, 60)
    intent = s.get("intent") or "deep mode"
    if s.get("broken_at"):
        out = {"text": "✗ broken", "class": "broken", "tooltip": "session broken — logged for the Friday review"}
    elif s.get("paused_at"):
        out = {"text": f"⏸ {mm:02d}:{ss:02d}", "class": "paused", "tooltip": f"paused · {intent}\nclick to resume"}
    elif rem == 0:
        # Expired while the app was closed: don't sit at 00:00 forever — the app cleans it up.
        out = {"text": "", "class": "idle", "tooltip": "mizan: last session ended — open the app to log it"}
    else:
        out = {"text": f"◎ {mm:02d}:{ss:02d}", "class": "focus", "tooltip": f"{intent}\nclick to pause · blocking active"}
except Exception:
    pass
print(json.dumps(out))
EOF
        ;;
    toggle-pause)
        python3 - <<'EOF'
import json, os
from datetime import datetime, timedelta

p = os.path.expanduser("~/.local/state/mizan/focus.json")
try:
    s = json.load(open(p))
except Exception:
    raise SystemExit(0)
if s.get("broken_at"):
    raise SystemExit(0)
now = datetime.now().astimezone()
if s.get("paused_at"):
    paused = datetime.fromisoformat(s["paused_at"])
    ends = datetime.fromisoformat(s["ends_at"])
    s["ends_at"] = (ends + (now - paused)).isoformat()
    s["paused_at"] = None
else:
    s["paused_at"] = now.isoformat()
json.dump(s, open(p, "w"), indent=2)
EOF
        ;;
    *)
        echo "usage: mizan-waybar.sh status|toggle-pause" >&2
        exit 1
        ;;
esac
