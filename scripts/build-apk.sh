#!/usr/bin/env bash
# build-apk.sh — build the Android phone companion and put it where you can find it:
#   releases/Mizan-companion.apk
#
#   pnpm android            build (or reuse an up-to-date build) and copy the APK
#   pnpm android --install  also install it on a phone connected with USB debugging
#   FLAVOR=foss pnpm android  build without Google Play services (no QR scanner; for F-Droid)
#   BUILD=release pnpm android  release build, signed with android/keystore.properties if present
#
# Needs JDK 17 and the Android SDK (platform 35, build-tools 35). See android/README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLAVOR="${FLAVOR:-play}"
BUILD="${BUILD:-debug}"
[[ "$FLAVOR" =~ ^(play|foss)$ && "$BUILD" =~ ^(debug|release)$ ]] || { echo "FLAVOR must be play|foss and BUILD debug|release." >&2; exit 1; }
APK="$ROOT/android/app/build/outputs/apk/$FLAVOR/$BUILD/app-$FLAVOR-$BUILD.apk"
SUFFIX=""; [[ "$FLAVOR" == foss ]] && SUFFIX="-foss"; [[ "$BUILD" == release ]] && SUFFIX="$SUFFIX-release"
OUT="$ROOT/releases/Mizan-companion$SUFFIX.apk"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"

newest_source() {
  find "$ROOT/android/app/src" "$ROOT/android/app/build.gradle.kts" "$ROOT/companion" -type f -newer "$APK" -print -quit 2>/dev/null
}

if [[ -f "$APK" && -z "$(newest_source)" ]]; then
  echo "APK is up to date."
else
  [[ -d "$ANDROID_HOME" ]] || { echo "Android SDK not found at $ANDROID_HOME. Set ANDROID_HOME or see android/README.md." >&2; exit 1; }
  cd "$ROOT/android"
  # Retry: Gradle's first run downloads a lot and flaky networks drop it.
  for attempt in 1 2 3; do
    if ./gradlew --no-daemon "assemble${FLAVOR^}${BUILD^}"; then break; fi
    [[ $attempt == 3 ]] && { echo "Build failed 3 times." >&2; exit 1; }
    echo "Build failed, retrying ($attempt/3)…" >&2
    sleep 5
  done
fi

mkdir -p "$ROOT/releases"
cp "$APK" "$OUT"
echo
echo "Phone app: $OUT ($(du -h "$OUT" | cut -f1))"

if [[ "${1:-}" == "--install" ]]; then
  ADB="$(command -v adb || echo "$ANDROID_HOME/platform-tools/adb")"
  [[ -x "$ADB" ]] || { echo "adb not found. Install platform-tools or copy the APK to the phone." >&2; exit 1; }
  "$ADB" install -r "$OUT"
else
  echo "Install: copy it to the phone and open it, or run: pnpm android --install"
fi
