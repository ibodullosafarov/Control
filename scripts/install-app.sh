#!/usr/bin/env bash
#
# Installs the packaged Control.app into the user's own ~/Applications folder.
#
# Why ~/Applications and not /Applications:
#   - /Applications is not writable without elevation, so the install would
#     fail (or demand a sudo password) for a normal user.
#   - macOS treats ~/Applications as a first-class per-user Applications
#     folder: the app shows up in Launchpad, Spotlight and the widget gallery.
#   - The WidgetKit extension must keep a stable on-disk path. PlugInKit
#     registers the .appex by absolute path, so moving the app would make the
#     widget re-register under a new path and lose its existing instances.
#
# Usage:
#   npm run install:app          # packages (--dir) and installs
#   bash scripts/install-app.sh  # installs an existing release/mac-arm64 build

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/release/mac-arm64/Control.app"
TARGET="$HOME/Applications/Control.app"
APP_EXEC="$TARGET/Contents/MacOS/Control"
APPEX_REL="Contents/PlugIns/ControlWidgetsExtension.appex"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

die() { echo "error: $*" >&2; exit 1; }

[ -d "$SRC" ] || die "$SRC not found - run 'npm run package:mac' first."
[ -d "$SRC/$APPEX_REL" ] || die "the WidgetKit extension is missing from the build ($SRC/$APPEX_REL)."

# 1. Stop the running app so the bundle can be replaced cleanly.
if pgrep -f "$APP_EXEC\$" >/dev/null 2>&1; then
  echo "==> Quitting the running app"
  osascript -e 'tell application "Control" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f "$APP_EXEC\$" >/dev/null 2>&1 || break
    sleep 0.25
  done
  pkill -f "$APP_EXEC\$" >/dev/null 2>&1 || true
fi

# 2. Replace the bundle. `ditto` preserves symlinks, permissions and extended
#    attributes; `cp -R` mangles the Electron framework symlinks.
mkdir -p "$(dirname "$TARGET")"
rm -rf "$TARGET"
ditto "$SRC" "$TARGET"
echo "==> Installed -> $TARGET"

# 3. Re-register with LaunchServices so PlugInKit picks up the embedded
#    WidgetKit extension (the .appex) and refreshes its registration.
if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -f "$TARGET" >/dev/null 2>&1 || true
fi

# 4. Sanity check: the extension must be embedded inside the app, never beside it.
[ -d "$TARGET/$APPEX_REL" ] || die "the WidgetKit extension is missing from $TARGET"

# 5. Relaunch.
open "$TARGET"
echo "==> Relaunched Control"
