#!/usr/bin/env bash
# Branch, push, pull request and CI helper for agents working in this repo.
# Works in shallow clones and in sessions where GitHub GraphQL (gh pr create) is blocked:
# every GitHub call uses the REST API. Never merges, never runs workflows, never prints secrets.
#
#   scripts/agent-pr.sh branch <name>          new branch from the latest origin/main, tracking set up
#   scripts/agent-pr.sh push                   push the current branch and set its upstream
#   scripts/agent-pr.sh pr <title> <body-file> open a pull request for the current branch
#   scripts/agent-pr.sh checks [sha]           check runs for a commit (default: HEAD)
#   scripts/agent-pr.sh smoke [sha]            PASS/FAIL/SKIP lines of the deployed smoke run
set -euo pipefail

repo="${AGENT_PR_REPO:-Shaked/x-thread-draft-tool}"
cmd="${1:-}"
shift || true

die() { echo "agent-pr: $*" >&2; exit 1; }
current_branch() { git rev-parse --abbrev-ref HEAD; }

# A shallow single-branch clone only fetches main, so remote branches have no tracking ref.
track() {
  local b="$1"
  local spec="+refs/heads/$b:refs/remotes/origin/$b"
  git config --get-all remote.origin.fetch | grep -qxF "$spec" || git config --add remote.origin.fetch "$spec"
  git fetch -q origin "$b"
  git branch -q --set-upstream-to="origin/$b" "$b"
}

case "$cmd" in
  branch)
    b="${1:?usage: branch <name>}"
    git fetch -q origin main
    git checkout -q -b "$b" origin/main
    echo "on $b (from origin/main $(git rev-parse --short origin/main))"
    ;;
  push)
    b="$(current_branch)"
    [ "$b" != main ] || die "refusing to push main; open a pull request instead"
    [ -z "$(git status --porcelain)" ] || die "uncommitted changes: commit them first"
    git push -q -u origin "$b"
    track "$b"
    git status -sb | head -1
    ;;
  pr)
    title="${1:?usage: pr <title> <body-file>}"
    body="${2:?usage: pr <title> <body-file>}"
    [ -f "$body" ] || die "body file not found: $body"
    b="$(current_branch)"
    gh api "repos/$repo/pulls" -f title="$title" -f head="$b" -f base=main -F body=@"$body" --jq .html_url
    ;;
  checks)
    sha="$(git rev-parse "${1:-HEAD}")"
    gh api "repos/$repo/commits/$sha/check-runs" --jq '.check_runs[] | [.name, .status, (.conclusion // "-")] | @tsv'
    ;;
  smoke)
    sha="$(git rev-parse "${1:-HEAD}")"
    id="$(gh api "repos/$repo/actions/workflows/smoke-deployed.yml/runs?head_sha=$sha" --jq '.workflow_runs[0].id // empty')"
    [ -n "$id" ] || die "no deployed smoke run for $sha yet"
    gh run view "$id" -R "$repo" --log | sed 's/\x1b\[[0-9;]*m//g' \
      | grep -E '^[^	]+	[^	]+	[^ ]+ (PASS|FAIL|SKIP) |[0-9]+/[0-9]+ passed|##\[(notice|error)\]' \
      | sed -E 's/^[^	]+	[^	]+	[^ ]+ //'
    ;;
  *)
    sed -n '2,10p' "$0"
    exit 1
    ;;
esac
