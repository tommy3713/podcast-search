#!/usr/bin/env bash
# One-time cutover from the Caddy inside the gooaye compose project to the shared proxy.
# Copies the issued certificates so nothing is re-requested; the site is down for a few
# seconds between the old Caddy stopping and the new one starting. Delete this file afterwards.
# Before running: ssh in and run `sudo install -d -o deploy -g deploy /opt/proxy /opt/proxy/sites`.
set -euo pipefail
HOST="${GOOAYE_HOST:-deploy@66.245.221.163}"
KEY="${GOOAYE_KEY:-$HOME/.ssh/gooaye_vps}"
DIR="$(cd "$(dirname "$0")" && pwd)"

scp -q -i "$KEY" "$DIR/compose.yml" "$DIR/Caddyfile" "$HOST:/opt/proxy/"
scp -q -i "$KEY" "$DIR/../gooaye.caddy" "$HOST:/opt/proxy/sites/"
scp -q -i "$KEY" "$DIR/../compose.yml" "$HOST:/opt/gooaye/"
ssh -i "$KEY" "$HOST" 'set -e
  (docker network inspect proxy >/dev/null 2>&1 || docker network create proxy >/dev/null)
  cd /opt/proxy && docker compose pull -q && docker compose create
  # Abort before touching the live site if the new config does not load
  docker compose run --rm -T caddy caddy validate --config /etc/caddy/Caddyfile
  for v in data config; do
    docker run --rm -v gooaye_caddy_$v:/from:ro -v proxy_caddy_$v:/to caddy:2.11 cp -a /from/. /to/
  done
  # Recreates web on the proxy network and removes the old caddy (an orphan now); worker is untouched
  cd /opt/gooaye && docker compose up -d --remove-orphans
  rm -f Caddyfile
  cd /opt/proxy && docker compose up -d
  docker compose ps --format "{{.Service}} {{.Status}}"'
sleep 3
curl -sS -o /dev/null -w 'gooaye-notes.com -> %{http_code}\n' https://gooaye-notes.com/
echo "Once it looks right: ssh in and run docker volume rm gooaye_caddy_data gooaye_caddy_config"
