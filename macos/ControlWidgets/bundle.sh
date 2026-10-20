#!/usr/bin/env bash
#
# Builds ONLY the native WidgetKit extension (.appex) and stages it for
# electron-builder to embed inside Control.app/Contents/PlugIns/.
#
# There is deliberately NO separate "Control Widgets" host app. A WidgetKit
# widget must be a real com.apple.product-type.app-extension built by
# xcodebuild (a hand-linked swiftc appex lacks the entry-point/runloop setup,
# so ExtensionFoundation traps at launch and the widget never registers). But
# the *containing* .app can be Control.app itself — the extension is embedded
# into Electron's bundle, so the user installs one app, not two.
#
# The extension stays sandboxed (PlugInKit requires it) with a read-only
# home-relative exception so it can read ~/.control-app/widget-state.json
# without an App Group. Control.app itself stays unsandboxed (it needs
# /etc/hosts + osascript admin); host and extension may differ here.
#
#   ./bundle.sh        build the .appex and stage it (no install)
#
# The staged appex is picked up by scripts/embed-widget.js (electron-builder
# afterPack/afterSign), which copies it into Control.app and signs inside-out.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

BUILD_DIR="$DIR/build"
DERIVED="$BUILD_DIR/dd"
PROJECT="ControlWidgets.xcodeproj"
SCHEME="ControlWidgets"

# Where electron-builder's extraResources pulls the appex from (staged copy).
STAGE_DIR="$DIR/../../build/widgets"
STAGE_APPEX="$STAGE_DIR/ControlWidgetsExtension.appex"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "bundle.sh: xcodegen is required (brew install xcodegen)" >&2
  exit 1
fi

echo "==> Generating Xcode project"
xcodegen generate >/dev/null

echo "==> Building extension with xcodebuild (Release)"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
xcodebuild \
  -project "$PROJECT" -scheme "$SCHEME" -configuration Release \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  build > "$BUILD_DIR/xcodebuild.log" 2>&1 \
  || { echo "xcodebuild failed:"; tail -50 "$BUILD_DIR/xcodebuild.log"; exit 1; }

# The extension product is produced directly as an .appex under the derived
# data products dir.
SRC_APPEX="$(find "$DERIVED/Build/Products" -name 'ControlWidgetsExtension.appex' -maxdepth 3 | head -1)"
if [ -z "$SRC_APPEX" ] || [ ! -d "$SRC_APPEX" ]; then
  echo "bundle.sh: extension product not found under $DERIVED/Build/Products" >&2
  exit 1
fi

echo "==> Staging appex for electron-builder"
rm -rf "$STAGE_APPEX"
mkdir -p "$STAGE_DIR"
cp -R "$SRC_APPEX" "$STAGE_APPEX"

# Pre-sign the staged appex with its sandbox entitlements so the embedded copy
# inside Control.app already carries a valid ad-hoc signature. scripts/embed-widget.js
# re-signs again inside-out during packaging to bind it to the final bundle.
ENTITLEMENTS="$DIR/ControlWidgets.entitlements"
if [ -f "$ENTITLEMENTS" ]; then
  echo "==> Ad-hoc signing staged appex (sandbox entitlements)"
  codesign --force --sign - --entitlements "$ENTITLEMENTS" "$STAGE_APPEX"
fi

echo "==> Staged: $STAGE_APPEX"
echo "    (run 'npm run package:dmg' — the afterPack hook embeds it into Control.app)"
