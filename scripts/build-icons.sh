#!/usr/bin/env bash
#
# Regenerates every shipped app-icon asset from the two Icon Composer exports.
#
# Raw, full-bleed exports (iOS-style, artwork touches the canvas edge):
#   assets/icon-source/Default.png   -> light appearance
#   assets/icon-source/Dark.png      -> dark appearance
#
# macOS draws app icons with ~10% transparent margin (Apple grid: the rounded
# square is 824x824 inside a 1024x1024 canvas). The exports are full-bleed, so we
# pad them to the macOS grid before shipping, otherwise the icon looks oversized
# in the Dock next to native apps.
#
# Outputs:
#   assets/AppIcon-Default.png / .icns   macOS-grid light mark (runtime Dock + bundle)
#   assets/AppIcon-Dark.png    / .icns   macOS-grid dark mark
#   build/AppIcon.icns                   appearance-aware bundle icon
#   build/Assets.car                     appearance-aware catalog (light + dark)
#   build/AppIcon-partial-info.plist     CFBundleIconName/CFBundleIconFile hints
#
# Requires macOS tooling: sips, iconutil, python3 (Pillow), and Xcode's actool.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SRC_DEFAULT="assets/icon-source/Default.png"
SRC_DARK="assets/icon-source/Dark.png"
CANVAS=1024      # macOS app-icon canvas
CONTENT=824      # rounded-square artwork size within the canvas (Apple grid)

for f in "$SRC_DEFAULT" "$SRC_DARK"; do
  if [ ! -f "$f" ]; then
    echo "build-icons: missing source $f" >&2
    exit 1
  fi
done

if ! python3 -c "import PIL" >/dev/null 2>&1; then
  echo "build-icons: python3 Pillow is required to pad icons (pip3 install Pillow)" >&2
  exit 1
fi

# Pad a full-bleed export onto the macOS icon grid (centered, transparent margin).
pad_to_grid() {
  python3 - "$1" "$2" "$CANVAS" "$CONTENT" <<'PY'
import sys
from PIL import Image

src, out, canvas, content = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(src).convert("RGBA")
art = im.resize((content, content), Image.LANCZOS)
grid = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
off = (canvas - content) // 2
grid.paste(art, (off, off), art)
grid.save(out)
PY
}

# --- macOS-grid PNGs -------------------------------------------------------
echo "build-icons: padding to macOS icon grid"
pad_to_grid "$SRC_DEFAULT" "assets/AppIcon-Default.png"
pad_to_grid "$SRC_DARK"    "assets/AppIcon-Dark.png"

# --- Standalone .icns (runtime Dock icon fallback) -------------------------
make_icns() {
  local src="$1" out="$2"
  local tmp set
  tmp="$(mktemp -d)"
  set="$tmp/AppIcon.iconset"
  mkdir -p "$set"
  sips -z 16 16     "$src" --out "$set/icon_16x16.png"      >/dev/null
  sips -z 32 32     "$src" --out "$set/icon_16x16@2x.png"   >/dev/null
  sips -z 32 32     "$src" --out "$set/icon_32x32.png"      >/dev/null
  sips -z 64 64     "$src" --out "$set/icon_32x32@2x.png"   >/dev/null
  sips -z 128 128   "$src" --out "$set/icon_128x128.png"    >/dev/null
  sips -z 256 256   "$src" --out "$set/icon_128x128@2x.png" >/dev/null
  sips -z 256 256   "$src" --out "$set/icon_256x256.png"    >/dev/null
  sips -z 512 512   "$src" --out "$set/icon_256x256@2x.png" >/dev/null
  sips -z 512 512   "$src" --out "$set/icon_512x512.png"    >/dev/null
  sips -z 1024 1024 "$src" --out "$set/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$set" -o "$out"
  rm -rf "$tmp"
  echo "  wrote $out"
}

echo "build-icons: generating standalone .icns"
make_icns "assets/AppIcon-Default.png" "assets/AppIcon-Default.icns"
make_icns "assets/AppIcon-Dark.png"    "assets/AppIcon-Dark.icns"

# --- Appearance-aware asset catalog ----------------------------------------
CATDIR="build/AppIcon.xcassets"
SETDIR="$CATDIR/AppIcon.appiconset"
rm -rf "$CATDIR"
mkdir -p "$SETDIR"

cat > "$CATDIR/Contents.json" <<'JSON'
{ "info" : { "author" : "xcode", "version" : 1 } }
JSON

sizes=(16 32 128 256 512)
entries=()
for variant in default dark; do
  src="assets/AppIcon-Default.png"; [ "$variant" = dark ] && src="assets/AppIcon-Dark.png"
  for s in "${sizes[@]}"; do
    one="$SETDIR/${variant}-${s}.png"
    two="$SETDIR/${variant}-${s}@2x.png"
    sips -z "$s" "$s" "$src" --out "$one" >/dev/null
    sips -z "$((s * 2))" "$((s * 2))" "$src" --out "$two" >/dev/null
    appearance=''
    if [ "$variant" = dark ]; then
      appearance=', "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ]'
    fi
    entries+=("    { \"filename\" : \"${variant}-${s}.png\", \"idiom\" : \"mac\", \"scale\" : \"1x\", \"size\" : \"${s}x${s}\"${appearance} }")
    entries+=("    { \"filename\" : \"${variant}-${s}@2x.png\", \"idiom\" : \"mac\", \"scale\" : \"2x\", \"size\" : \"${s}x${s}\"${appearance} }")
  done
done

{
  echo '{'
  echo '  "images" : ['
  printf '%s,\n' "${entries[@]}" | sed '$ s/,$//'
  echo '  ],'
  echo '  "info" : { "author" : "xcode", "version" : 1 }'
  echo '}'
} > "$SETDIR/Contents.json"

echo "build-icons: compiling appearance-aware Assets.car"
mkdir -p build
xcrun actool "$CATDIR" \
  --compile build \
  --platform macosx \
  --minimum-deployment-target 11.0 \
  --app-icon AppIcon \
  --output-partial-info-plist build/AppIcon-partial-info.plist >/dev/null

echo "build-icons: done -> build/Assets.car, build/AppIcon.icns"
