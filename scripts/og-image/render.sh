#!/usr/bin/env bash
# Regenerates the site's share image (src/app/opengraph-image.png; X falls back to it) from
# og.html: headless Chrome takes a 1200x630 screenshot, Pillow re-encodes it. macOS paths.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR/../.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 \
  --virtual-time-budget=8000 --screenshot="$TMP/raw.png" "file://$DIR/og.html" 2>/dev/null
python3 -c "from PIL import Image; Image.open('$TMP/raw.png').convert('RGB').save('$TMP/og.png', optimize=True)"
cp "$TMP/og.png" "$ROOT/src/app/opengraph-image.png"
echo "wrote src/app/opengraph-image.png"
