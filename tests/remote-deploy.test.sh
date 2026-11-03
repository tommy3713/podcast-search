#!/usr/bin/env bash
# Smoke test for deploy/remote-deploy.sh: runs the whole script against stub docker, curl,
# flock, date and sleep in a temp directory, then checks every step ran and the files it leaves.
# It catches shell mistakes (the first real deploy died on an unquoted `step=更新 Caddy`),
# not Docker behaviour. Runs: a deploy that succeeds, a new release whose site check fails
# and is rolled back, a rollback that doesn't bring the site back either, and a failure early
# in a deploy that finds files left by an interrupted one. Run by CI's check job:
# bash tests/remote-deploy.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
SHA=0123456789abcdef0123456789abcdef01234567
OLD=89abcdef0123456789abcdef0123456789abcdef

# A fresh VPS layout in $TMP/<name>, running release $OLD; sets T and LOG for the run
setup() {
  T="$TMP/$1"
  LOG="$T/log"
  mkdir -p "$T/bin" "$T/app/data" "$T/proxy/sites"
  echo 'old compose' > "$T/app/compose.yml"
  echo "TAG=$OLD" > "$T/app/.env"
  printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_CHAT_ID=%s\n' "${2:-}" "${3:-}" > "$T/app/worker.env"
  echo '{"running":null,"since":null,"waiting":0}' > "$T/app/data/app.db.queue.json"
  echo 'old site' > "$T/proxy/sites/gooaye.caddy"

  # Logs what compose.yml / the Caddy site say at the moment web is started / Caddy reloaded,
  # so the rollback's order shows. PULL_FAILS=1 fails the image pull.
  cat > "$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
seen=""
case "$*" in
  *" up "*) seen=" [compose: $(cat "$APP/compose.yml")]" ;;
  *"caddy reload"*) seen=" [site: $(cat "$PROXY/sites/gooaye.caddy")]" ;;
esac
echo "docker TAG=${TAG:-} $*$seen" >> "$LOG"
case "$*" in
  *"ps --status running -q worker"*) echo worker-container ;;
  "images "*) printf 'ghcr.io/tommy3713/gooaye-web:old\nghcr.io/tommy3713/gooaye-web:latest\n' ;;
  *" pull "*) [[ -z "${PULL_FAILS:-}" ]] || exit 1 ;;
esac
exit 0
EOF
  # The homepage through Caddy fails the way curl -f does on a 502: with SITE_DOWN=new while
  # compose.yml is the new release's, with SITE_DOWN=all always
  cat > "$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$LOG"
out=""; prev=""
for a in "$@"; do [[ "$prev" == -o ]] && out="$a"; prev="$a"; done
case "$*" in
  *deploy/compose.yml*) echo 'new compose' > "$out" ;;
  *deploy/gooaye.caddy*) echo 'new site' > "$out" ;;
  *api.github.com*/commits/*) echo '  "message": "feat: test\n\nbody",' ;;
  *gooaye-notes.com:443:127.0.0.1*)
    if [[ "${SITE_DOWN:-}" == all || ( "${SITE_DOWN:-}" == new && "$(cat "$APP/compose.yml")" == 'new compose' ) ]]; then
      echo "curl: (22) The requested URL returned error: 502" >&2; exit 22
    fi
    printf '<title>股癌搜尋</title>\n200' ;;
esac
exit 0
EOF
  printf '#!/usr/bin/env bash\nexit 0\n' > "$T/bin/flock"
  # Far from a :00/:30 slot, so the worker is replaced without waiting
  printf '#!/usr/bin/env bash\necho 10\n' > "$T/bin/date"
  printf '#!/usr/bin/env bash\necho "sleep $*" >> "$LOG"\n' > "$T/bin/sleep"
  chmod +x "$T/bin/"*
}
deploy() {
  LOG="$LOG" APP="$T/app" PROXY="$T/proxy" PATH="$T/bin:$PATH" WORKER_WAIT_MIN=1 \
    bash "$ROOT/deploy/remote-deploy.sh" "$SHA" > "$T/out" 2>&1
}

fail=0
name() { basename "$T"; }
expect() { grep -qF -- "$1" "$2" || { echo "FAIL ($(name)): expected '$1' in $(basename "$2")"; fail=1; }; }
reject() { ! grep -qF -- "$1" "$2" || { echo "FAIL ($(name)): did not expect '$1' in $(basename "$2")"; fail=1; }; }
count() { [[ $(grep -cF -- "$1" "$LOG") == "$2" ]] || { echo "FAIL ($(name)): expected '$1' $2 times in log, got $(grep -cF -- "$1" "$LOG")"; fail=1; }; }
no_leftovers() {
  for f in compose.next.yml compose.yml.prev gooaye.caddy.next gooaye.caddy.prev; do
    [[ ! -e "$T/app/$f" ]] || { echo "FAIL ($(name)): $f left behind"; fail=1; }
  done
}
# Nothing of the new release stays: old compose file, site, TAG; worker and images untouched
rolled_back() {
  reject "compose up -d --no-deps worker" "$LOG"
  reject "rmi" "$LOG"
  expect "old compose" "$T/app/compose.yml"
  expect "old site" "$T/proxy/sites/gooaye.caddy"
  expect "TAG=$OLD" "$T/app/.env"
  [[ ! -e "$T/app/.deployed" ]] || { echo "FAIL ($(name)): .deployed written"; fail=1; }
  no_leftovers
}
done_case() { (( fail == 0 )) || { cat "$T/out"; exit 1; }; }

# 1. Everything works: new compose file, site and release are in place, the worker is replaced
setup ok
deploy || { cat "$T/out"; echo "FAIL (ok): script exited non-zero"; exit 1; }
expect "compose -f compose.next.yml config -q" "$LOG"
expect "compose -f compose.next.yml pull -q" "$LOG"
expect "worker/main.ts migrate" "$LOG"
expect "compose up -d --no-deps --remove-orphans web [compose: new compose]" "$LOG"
expect "caddy reload --config /etc/caddy/Caddyfile [site: new site]" "$LOG"
count "gooaye-notes.com:443:127.0.0.1" 1
expect "compose up -d --no-deps worker" "$LOG"
expect "rmi" "$LOG"
reject "sleep" "$LOG"
expect "new compose" "$T/app/compose.yml"
expect "new site" "$T/proxy/sites/gooaye.caddy"
expect "TAG=$SHA" "$T/app/.env"
expect "$SHA" "$T/app/.deployed"
expect "$SHA" "$T/app/.deployed-worker"
no_leftovers
done_case

# 2. The new release never answers through Caddy: 12 tries, then the old compose file and site
#    go back first, Caddy is reloaded with the old site, web restarts on $OLD and answers again
setup site-down token chat
if SITE_DOWN=new deploy; then cat "$T/out"; echo "FAIL (site-down): script exited zero"; exit 1; fi
count "gooaye-notes.com:443:127.0.0.1" 13
count "caddy reload" 2
[[ $(grep "caddy reload" "$LOG" | tail -1) == *"[site: old site]" ]] \
  || { echo "FAIL (site-down): Caddy not reloaded with the old site last"; fail=1; }
expect "docker TAG=$OLD compose up -d --no-deps web [compose: old compose]" "$LOG"
expect "失敗（檢查網站），網站已退回原本的版本" "$LOG"
rolled_back
done_case

# 3. The old release doesn't answer either after the rollback: the message says so
setup still-down token chat
if SITE_DOWN=all deploy; then cat "$T/out"; echo "FAIL (still-down): script exited zero"; exit 1; fi
count "gooaye-notes.com:443:127.0.0.1" 18
expect "失敗（檢查網站），退回後網站仍然沒有回應" "$LOG"
rolled_back
done_case

# 4. A deploy killed mid-way left .prev files; this one fails before touching web, and must
#    neither restore those files nor reload Caddy
setup stale token chat
echo 'stale compose' > "$T/app/compose.yml.prev"
echo 'stale site' > "$T/app/gooaye.caddy.prev"
if PULL_FAILS=1 deploy; then cat "$T/out"; echo "FAIL (stale): script exited zero"; exit 1; fi
reject "caddy reload" "$LOG"
reject " up " "$LOG"
expect "失敗（下載映像檔），網站維持原本的版本" "$LOG"
rolled_back
done_case
echo "remote-deploy.sh smoke test passed"
