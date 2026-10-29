#!/usr/bin/env bash
# Deploy the latest images from ghcr to the VPS. Run after GitHub Actions goes green:
#   deploy/deploy.sh                   # latest
#   TAG=<git sha> deploy/deploy.sh     # a specific build (rollback)
# A changed worker image restarts the worker and interrupts the episode it is on (a retry
# resumes from the saved checkpoint), so check /status in Telegram first.
set -euo pipefail
HOST="${GOOAYE_HOST:-deploy@66.245.221.163}"
KEY="${GOOAYE_KEY:-$HOME/.ssh/gooaye_vps}"
DIR="$(cd "$(dirname "$0")" && pwd)"

scp -q -i "$KEY" "$DIR/compose.yml" "$DIR/Caddyfile" "$HOST:/opt/gooaye/"
ssh -i "$KEY" "$HOST" "cd /opt/gooaye && export TAG='${TAG:-latest}' \
  && docker compose pull -q && docker compose up -d --remove-orphans \
  && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile \
  && docker image prune -f >/dev/null && docker compose ps --format '{{.Service}} {{.Status}}'"
