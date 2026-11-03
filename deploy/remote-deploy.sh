#!/usr/bin/env bash
# Deploys one commit of gooaye on the VPS: `remote-deploy.sh <sha>`. Run by deploy-hook (GitHub
# Actions, after CI pushed the images tagged <sha>) or by deploy/deploy.sh (by hand).
#   1. fetch compose.yml and gooaye.caddy at <sha> and validate them; pull the images
#   2. run migrations with the new worker image (migrations must work with the old code too)
#   3. replace web, reload Caddy; on failure put the previous compose file and site back
#   4. replace the worker once its job queue is idle (up to WORKER_WAIT_MIN), so an episode in
#      progress isn't interrupted; otherwise leave the old worker running and say so
#   5. keep the images web and worker run plus the previous deploy's; report to Telegram
# Rollbacks only reach commits that contain this script (older images have no `migrate`).
set -euo pipefail
SHA="${1:?usage: remote-deploy.sh <40-character commit sha>}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "not a commit sha: $SHA" >&2; exit 2; }
REPO=tommy3713/podcast-search
APP=/opt/gooaye
PROXY=/opt/proxy
WORKER_WAIT_MIN="${WORKER_WAIT_MIN:-60}"
SHORT="${SHA:0:7}"
cd "$APP"

exec 9>"$APP/.deploy.lock"
flock -n 9 || { echo "another deploy is running" >&2; exit 1; }

# Telegram through the worker's own bot, so the token never leaves the VPS
notify() {
  local token chat
  token=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' worker.env | tr -d '"'"'"' ')
  chat=$(sed -n 's/^TELEGRAM_CHAT_ID=//p' worker.env | tr -d '"'"'"' ')
  [[ -n "$token" && -n "$chat" ]] || return 0
  curl -fsS -o /dev/null "https://api.telegram.org/bot$token/sendMessage" \
    --data-urlencode "chat_id=$chat" --data-urlencode "text=$1" || true
}
step=準備
# The release running now, to go back to if this one fails after web was replaced
PREV_TAG=$(sed -n 's/^TAG=//p' .env 2>/dev/null || true)
web_replaced=0
on_error() {
  trap - ERR
  if [[ -f compose.yml.prev ]]; then mv compose.yml.prev compose.yml; fi
  if [[ -f gooaye.caddy.prev ]]; then cp gooaye.caddy.prev "$PROXY/sites/gooaye.caddy"; fi
  rm -f compose.next.yml gooaye.caddy.next gooaye.caddy.prev
  if (( web_replaced )); then TAG="${PREV_TAG:-latest}" docker compose up -d --no-deps web || true; fi
  notify "❌ 部署 $SHORT 失敗（$step），網站維持原本的版本"
}
trap on_error ERR

step=下載設定檔
curl -fsS "https://raw.githubusercontent.com/$REPO/$SHA/deploy/compose.yml" -o compose.next.yml
curl -fsS "https://raw.githubusercontent.com/$REPO/$SHA/deploy/gooaye.caddy" -o gooaye.caddy.next
export TAG="$SHA"
docker compose -f compose.next.yml config -q

step=下載映像檔
docker compose -f compose.next.yml pull -q

step=資料庫遷移
docker compose -f compose.next.yml run --rm --no-deps -T worker node --import tsx worker/main.ts migrate

step=更新網站
cp compose.yml compose.yml.prev
mv compose.next.yml compose.yml
web_replaced=1
docker compose up -d --no-deps --remove-orphans web

step=更新 Caddy
cp "$PROXY/sites/gooaye.caddy" gooaye.caddy.prev
cp gooaye.caddy.next "$PROXY/sites/gooaye.caddy"
docker compose -f "$PROXY/compose.yml" exec -T caddy caddy reload --config /etc/caddy/Caddyfile
rm -f gooaye.caddy.next gooaye.caddy.prev compose.yml.prev
# Later manual `docker compose` commands use this release instead of falling back to :latest
echo "TAG=$SHA" > .env
web_replaced=0

step=更新 worker
queue_busy() {
  [[ -n "$(docker compose ps --status running -q worker)" ]] || return 1
  if [[ -f data/app.db.queue.json ]]; then
    ! grep -q '"running":null,.*"waiting":0' data/app.db.queue.json
  else
    # A worker from before the queue file existed: busy while an episode is mid-pipeline
    [[ "$(sqlite3 -readonly data/app.db "SELECT COUNT(*) FROM episodes WHERE status IN ('transcribing','summarizing')")" != 0 ]]
  fi
}
# The scheduler starts jobs at :00 and :30; replacing the worker right then could cut one off
near_slot() {
  local m=$((10#$(TZ=Asia/Taipei date +%M) % 30))
  (( m >= 28 || m <= 1 ))
}
waited=0
while { queue_busy || near_slot; } && (( waited < WORKER_WAIT_MIN * 60 )); do
  if (( waited == 0 )); then echo "waiting for an idle worker (up to ${WORKER_WAIT_MIN} min)"; fi
  sleep 20
  waited=$((waited + 20))
done
if queue_busy || near_slot; then
  worker_note="worker 忙碌超過 ${WORKER_WAIT_MIN} 分鐘，仍是舊版（空閒時再跑一次部署）"
else
  docker compose up -d --no-deps worker
  echo "$SHA" > .deployed-worker
  worker_note="worker 已更新"
fi

step=清理
prev=$(cat .deployed 2>/dev/null || true)
if [[ -n "$prev" && "$prev" != "$SHA" ]]; then echo "$prev" > .deployed.prev; fi
echo "$SHA" > .deployed
keep="$SHA|$(cat .deployed.prev 2>/dev/null || echo none)|$(cat .deployed-worker 2>/dev/null || echo none)"
docker images --format '{{.Repository}}:{{.Tag}}' | grep '^ghcr.io/tommy3713/gooaye-' | grep -Ev ":($keep|latest)$" \
  | xargs -r docker rmi >/dev/null 2>&1 || true
docker image prune -f >/dev/null

trap - ERR
docker compose ps --format '{{.Service}} {{.Image}} {{.Status}}'
title=$(curl -fsS "https://api.github.com/repos/$REPO/commits/$SHA" | grep -m1 '"message"' | sed 's/.*"message": *"//; s/\\n.*//; s/",*$//' || true)
notify "🚀 已部署 $SHORT ${title}
web 已更新，$worker_note"
