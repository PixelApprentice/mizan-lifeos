#!/usr/bin/env bash
# Register the mizan-bridge native messaging host for Firefox (current user).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.mozilla/native-messaging-hosts"
mkdir -p "$DEST"
chmod +x "$DIR/mizan-bridge.py"
cat > "$DEST/mizan_bridge.json" <<EOF
{
  "name": "mizan_bridge",
  "description": "Mizan focus state and tasks bridge",
  "path": "$DIR/mizan-bridge.py",
  "type": "stdio",
  "allowed_extensions": ["mizan-guard@salahudin.local"]
}
EOF
echo "Registered native host at $DEST/mizan_bridge.json -> $DIR/mizan-bridge.py"
