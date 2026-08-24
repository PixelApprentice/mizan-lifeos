#!/usr/bin/env bash
# install-desktop.sh — put Mizan in the app launcher (rofi/wofi/any XDG menu) with its icon,
# so it opens like any other app instead of via `pnpm tauri dev` in a terminal.
# Run after: pnpm tauri build --no-bundle
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/src-tauri/target/release/mizan"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"

if [[ ! -x "$BIN" ]]; then
  echo "No release binary at $BIN — run: pnpm tauri build --no-bundle" >&2
  exit 1
fi

mkdir -p "$HOME/.local/bin" "$DATA/applications"
ln -sf "$BIN" "$HOME/.local/bin/mizan"

for s in 32 64 128 256 512; do
  dir="$DATA/icons/hicolor/${s}x${s}/apps"
  mkdir -p "$dir"
  case "$s" in
    256) src="$ROOT/src-tauri/icons/128x128@2x.png" ;;
    512) src="$ROOT/src-tauri/icons/icon.png" ;;
    *)   src="$ROOT/src-tauri/icons/${s}x${s}.png" ;;
  esac
  install -m 644 "$src" "$dir/mizan.png"
done
mkdir -p "$DATA/icons/hicolor/scalable/apps"
install -m 644 "$ROOT/public/mizan-icon.svg" "$DATA/icons/hicolor/scalable/apps/mizan.svg"

cat > "$DATA/applications/mizan.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Mizan
GenericName=LifeOS planner
Comment=The balance — today, planner, projects, deep mode, log
Exec="$BIN"
Icon=mizan
Terminal=false
Categories=Office;ProjectManagement;Utility;
Keywords=focus;planner;kanban;log;discipline;
StartupWMClass=mizan
EOF

command -v update-desktop-database >/dev/null && update-desktop-database "$DATA/applications" || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$DATA/icons/hicolor" || true

echo "Installed: $DATA/applications/mizan.desktop (icon: mizan) · binary linked at ~/.local/bin/mizan"
