#!/usr/bin/env bash
# Project wrapper for the pr-workflow plugin. branch, push, pr, checks and repo are the plugin's;
# smoke stays here, because it reads this app's deployed smoke run.
#
#   scripts/agent-pr.sh smoke [sha]            PASS/FAIL/SKIP lines of the deployed smoke run
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
helper="$here/../plugins/pr-workflow/scripts/agent-pr.sh"

if [ "${1:-}" != smoke ]; then
  exec "$helper" "$@"
fi
shift

repo="$("$helper" repo)"
sha="$(git rev-parse "${1:-HEAD}")"
id="$(gh api "repos/$repo/actions/workflows/smoke-deployed.yml/runs?head_sha=$sha" --jq '.workflow_runs[0].id // empty')"
[ -n "$id" ] || { echo "agent-pr: no deployed smoke run for $sha yet" >&2; exit 1; }
gh run view "$id" -R "$repo" --log | sed 's/\x1b\[[0-9;]*m//g' \
  | grep -E '^[^	]+	[^	]+	[^ ]+ (PASS|FAIL|SKIP) |[0-9]+/[0-9]+ passed|##\[(notice|error)\]' \
  | sed -E 's/^[^	]+	[^	]+	[^ ]+ //'
