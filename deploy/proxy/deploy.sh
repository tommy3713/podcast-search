#!/usr/bin/env bash
# Deploy the shared Caddy reverse proxy to /opt/proxy on the VPS. Only needed when
# deploy/proxy/compose.yml or Caddyfile changes; app deploys upload their own sites/*.caddy.
# First time only: ssh in and run `sudo install -d -o deploy -g deploy /opt/proxy /opt/proxy/sites`.
set -euo pipefail
HOST="${GOOAYE_HOST:-deploy@66.245.221.163}"
KEY="${GOOAYE_KEY:-$HOME/.ssh/gooaye_vps}"
DIR="$(cd "$(dirname "$0")" && pwd)"

scp -q -i "$KEY" "$DIR/compose.yml" "$DIR/Caddyfile" "$HOST:/opt/proxy/"
ssh -i "$KEY" "$HOST" "cd /opt/proxy \
  && (docker network inspect proxy >/dev/null 2>&1 || docker network create proxy >/dev/null) \
  && docker compose pull -q && docker compose up -d --remove-orphans \
  && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile \
  && docker compose ps --format '{{.Service}} {{.Status}}'"
