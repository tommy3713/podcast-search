#!/usr/bin/env bash
# Regenerates src/app/favicon.ico (16, 32, 48 px) and src/app/apple-icon.png (180 px) from
# src/app/icon.svg: headless Chrome draws each size from icons.html, Pillow crops and encodes.
# Each size is drawn by Chrome rather than scaled down, so small sizes stay sharp. macOS paths.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR/../.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --default-background-color=00000000 --window-size=276,180 \
  --virtual-time-budget=4000 --screenshot="$TMP/strip.png" "file://$DIR/icons.html" 2>/dev/null
[ -s "$TMP/strip.png" ] || { echo "Chrome wrote no screenshot (set CHROME to its binary)" >&2; exit 1; }
python3 - "$TMP/strip.png" "$ROOT/src/app" <<'EOF'
import sys
from PIL import Image
strip, out = Image.open(sys.argv[1]).convert('RGBA'), sys.argv[2]
# The crops below assume this exact size; a smaller one would be padded without an error
assert strip.size == (276, 180), f'screenshot is {strip.size}, expected (276, 180)'
ico = [strip.crop((x, 0, x + s, s)) for x, s in ((0, 16), (16, 32), (48, 48))]
ico[2].save(f'{out}/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)], append_images=ico[:2])
# Pillow without ICO append_images would quietly downscale the 48 px frame instead
for frame in ico[:2]:
    saved = Image.open(f'{out}/favicon.ico')
    saved.size = frame.size
    assert saved.convert('RGBA').tobytes() == frame.tobytes(), f'{frame.size} frame was rescaled; upgrade Pillow'
strip.crop((96, 0, 276, 180)).convert('RGB').save(f'{out}/apple-icon.png', optimize=True)
EOF
echo "wrote src/app/favicon.ico and src/app/apple-icon.png"
