#!/usr/bin/env bash
# Deploys by hand. Merges to main deploy automatically (.github/workflows/deploy.yml); use this
# to roll back, to retry, or to try a change to deploy/remote-deploy.sh before merging it:
#   deploy/deploy.sh                 # the newest commit on origin/main that has images
#   deploy/deploy.sh <git sha>       # a specific commit on main (rollback); its images must exist
# Runs this checkout's remote-deploy.sh with your own key, and refreshes the deploy-hook that
# the GitHub Actions key is locked to. Both wait for the worker's queue to be idle.
set -euo pipefail
HOST="${GOOAYE_HOST:-deploy@66.245.221.163}"
KEY="${GOOAYE_KEY:-$HOME/.ssh/gooaye_vps}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel)"
if [[ -n "${1:-}" ]]; then
  SHA=$(git -C "$ROOT" rev-parse "$1")
else
  # The newest commit on main that CI built images for (same paths-ignore as ci.yml).
  # Pathspecs are relative to the working directory, hence the repo root.
  git -C "$ROOT" fetch -q origin main
  SHA=$(git -C "$ROOT" log -1 --format=%H origin/main -- . ':!docs' ':!*.md' ':!memory' ':!.claude')
fi

ssh -i "$KEY" "$HOST" 'mkdir -p /opt/gooaye/bin'
scp -q -i "$KEY" "$DIR/deploy-hook.sh" "$HOST:/opt/gooaye/bin/deploy-hook"
scp -q -i "$KEY" "$DIR/remote-deploy.sh" "$HOST:/opt/gooaye/bin/remote-deploy.sh"
ssh -i "$KEY" -o ServerAliveInterval=30 "$HOST" \
  "chmod 755 /opt/gooaye/bin/deploy-hook && bash /opt/gooaye/bin/remote-deploy.sh $SHA"
