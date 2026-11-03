#!/usr/bin/env bash
# Installed at /opt/gooaye/bin/deploy-hook on the VPS (deploy/deploy.sh keeps it up to date).
# It is the forced command of the GitHub Actions deploy key in ~deploy/.ssh/authorized_keys:
#   restrict,command="/opt/gooaye/bin/deploy-hook" ssh-ed25519 AAAA... github-actions-deploy
# so that key can do nothing but deploy a commit that is already on main. The deploy steps
# themselves come from deploy/remote-deploy.sh at that same commit, so changes to them ship
# through a reviewed PR like everything else.
set -euo pipefail
REPO=tommy3713/podcast-search
SHA="${SSH_ORIGINAL_COMMAND:-${1:-}}"
fail() { echo "deploy-hook: $*" >&2; exit 1; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail "expected a 40-character commit sha, got '${SHA:0:60}'"

# "identical" or "behind" means the commit is on main's history
compare=$(curl -sS -w '\n%{http_code}' "https://api.github.com/repos/$REPO/compare/main...$SHA") || fail "GitHub API unreachable"
code=${compare##*$'\n'}
[[ "$code" == 200 ]] || fail "GitHub compare API returned $code: $(head -c 200 <<<"$compare")"
status=$(grep -o '"status": *"[a-z]*"' <<<"$compare" | head -1 | sed 's/.*"\([a-z]*\)"$/\1/' || true)
[[ "$status" == identical || "$status" == behind ]] || fail "$SHA is not on main (compare status: ${status:-unknown})"

script=$(mktemp)
trap 'rm -f "$script"' EXIT
curl -fsS "https://raw.githubusercontent.com/$REPO/$SHA/deploy/remote-deploy.sh" -o "$script" \
  || fail "deploy/remote-deploy.sh not found at $SHA (rollbacks only reach commits that have it)"
bash "$script" "$SHA"
