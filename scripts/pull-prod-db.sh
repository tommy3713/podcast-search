#!/usr/bin/env bash
# Copy the live database to data/prod.db for local testing. Listeners' questions
# (ask_log, ask_usage) and who sent each typo report (typo_reports.user_id) are removed on
# the VPS before anything is downloaded, and the live file is only read: the work happens
# on an online backup copy in /tmp.
#   scripts/pull-prod-db.sh && DB_PATH=data/prod.db npm run dev
set -euo pipefail
HOST="${GOOAYE_HOST:-deploy@66.245.221.163}"
KEY="${GOOAYE_KEY:-$HOME/.ssh/gooaye_vps}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/data/prod.db"
mkdir -p "$(dirname "$OUT")"

ssh -i "$KEY" "$HOST" 'set -e
  f=$(mktemp /tmp/gooaye-XXXXXX.db); trap "rm -f $f" EXIT
  sqlite3 /opt/gooaye/data/app.db ".backup $f"
  sqlite3 "$f" "DELETE FROM ask_log; DELETE FROM ask_usage;"
  # Absent before the release that added it
  if [ -n "$(sqlite3 "$f" "SELECT 1 FROM sqlite_master WHERE name = '\''typo_reports'\''")" ]; then
    sqlite3 "$f" "UPDATE typo_reports SET user_id = NULL;"
  fi
  sqlite3 "$f" "VACUUM;"
  gzip -c "$f"' | gunzip > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
rm -f "$OUT-wal" "$OUT-shm"
echo "data/prod.db: $(sqlite3 -readonly "$OUT" "SELECT COUNT(*) FROM episodes WHERE status = 'done'") episodes"
