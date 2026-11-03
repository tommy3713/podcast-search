#!/usr/bin/env bash
# Smoke test for deploy/remote-deploy.sh: runs the whole script against stub docker, curl,
# flock and date in a temp directory, then checks every step ran and the files it leaves.
# It catches shell mistakes (the first real deploy died on an unquoted `step=更新 Caddy`),
# not Docker behaviour. Run by CI's check job: bash tests/remote-deploy.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
SHA=0123456789abcdef0123456789abcdef01234567

mkdir -p "$T/bin" "$T/app/data" "$T/proxy/sites"
echo 'old compose' > "$T/app/compose.yml"
printf 'TELEGRAM_BOT_TOKEN=\nTELEGRAM_CHAT_ID=\n' > "$T/app/worker.env"
echo '{"running":null,"since":null,"waiting":0}' > "$T/app/data/app.db.queue.json"
echo 'old site' > "$T/proxy/sites/gooaye.caddy"

cat > "$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$LOG"
case "$*" in
  *"ps --status running -q worker"*) echo worker-container ;;
  "images "*) printf 'ghcr.io/tommy3713/gooaye-web:old\nghcr.io/tommy3713/gooaye-web:latest\n' ;;
esac
exit 0
EOF
cat > "$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$LOG"
out=""; prev=""
for a in "$@"; do [[ "$prev" == -o ]] && out="$a"; prev="$a"; done
case "$*" in
  *deploy/compose.yml*) echo 'new compose' > "$out" ;;
  *deploy/gooaye.caddy*) echo 'new site' > "$out" ;;
  *api.github.com*/commits/*) echo '  "message": "feat: test\n\nbody",' ;;
esac
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/flock"
# Far from a :00/:30 slot, so the worker is replaced without waiting
printf '#!/usr/bin/env bash\necho 10\n' > "$T/bin/date"
chmod +x "$T/bin/"*

export LOG="$T/log" APP="$T/app" PROXY="$T/proxy" PATH="$T/bin:$PATH" WORKER_WAIT_MIN=1
bash "$ROOT/deploy/remote-deploy.sh" "$SHA" > "$T/out" 2>&1 || { cat "$T/out"; echo "FAIL: script exited non-zero"; exit 1; }

fail=0
expect() { grep -qF -- "$1" "$2" || { echo "FAIL: expected '$1' in $(basename "$2")"; fail=1; }; }
expect "compose -f compose.next.yml config -q" "$LOG"
expect "compose -f compose.next.yml pull -q" "$LOG"
expect "worker/main.ts migrate" "$LOG"
expect "compose up -d --no-deps --remove-orphans web" "$LOG"
expect "caddy reload" "$LOG"
expect "compose up -d --no-deps worker" "$LOG"
expect "rmi" "$LOG"
expect "new compose" "$T/app/compose.yml"
expect "new site" "$T/proxy/sites/gooaye.caddy"
expect "TAG=$SHA" "$T/app/.env"
expect "$SHA" "$T/app/.deployed"
expect "$SHA" "$T/app/.deployed-worker"
for f in compose.next.yml compose.yml.prev gooaye.caddy.next gooaye.caddy.prev; do
  [[ ! -e "$T/app/$f" ]] || { echo "FAIL: $f left behind"; fail=1; }
done
(( fail == 0 )) || { cat "$T/out"; exit 1; }
echo "remote-deploy.sh smoke test passed"
