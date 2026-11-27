#!/usr/bin/env bash
# Branch, push, pull request and check helper for agents (pr-workflow plugin).
# Works in shallow clones and where GitHub GraphQL is blocked: GitHub calls use the REST API through `gh api`.
# Never merges, never runs workflows, never prints secrets.
#
#   agent-pr.sh repo                           the repository this project uses (see below)
#   agent-pr.sh branch <name>                  new branch from the latest origin/main, tracking set up
#   agent-pr.sh push                           push the current branch and set its upstream
#   agent-pr.sh pr <title> <body-file>         open a pull request for the current branch
#   agent-pr.sh checks [sha]                   check runs for a commit (default: HEAD)
#
# The repository is $AGENT_PR_REPO, else "repo" in .claude/agent-kit.json, else the origin remote on github.com.
# The config file is $CLAUDE_PROJECT_DIR/.claude/agent-kit.json, else in the git root of the working folder.
set -euo pipefail

cmd="${1:-}"
shift || true

die() { echo "agent-pr: $*" >&2; exit 1; }
current_branch() { git rev-parse --abbrev-ref HEAD; }

name_re='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'

# Prints owner/name. A broken config file stops the script; a missing file or key falls through to origin.
repo_name() {
  local found="" root file remote
  if [ -n "${AGENT_PR_REPO:-}" ]; then
    found="$AGENT_PR_REPO"
  else
    root="$(git rev-parse --show-toplevel 2>/dev/null)" || root="$PWD"
    file="${CLAUDE_PROJECT_DIR:-$root}/.claude/agent-kit.json"
    if [ -f "$file" ]; then
      found="$(node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (c.repo !== undefined && typeof c.repo !== "string") process.exit(3); process.stdout.write(c.repo || "")' "$file" 2>/dev/null)" \
        || die "$file is not JSON, or its \"repo\" key is not a string"
    fi
  fi
  if [ -z "$found" ]; then
    # Only the owner/name part of the origin URL is kept; the URL itself (it may hold a token) is never printed.
    remote="$(git remote get-url origin 2>/dev/null || true)"
    found="$(printf '%s' "$remote" | sed -E 's#^(git@github\.com:|ssh://git@github\.com/|https://github\.com/)##; s#\.git$##')"
    [[ "$found" =~ $name_re ]] || die 'no repository: set AGENT_PR_REPO, "repo" in .claude/agent-kit.json, or an origin remote on github.com'
  fi
  [[ "$found" =~ $name_re ]] || die 'repository must be owner/name: check AGENT_PR_REPO or "repo" in .claude/agent-kit.json'
  printf '%s\n' "$found"
}

# A shallow single-branch clone only fetches main, so remote branches have no tracking ref.
track() {
  local b="$1"
  local spec="+refs/heads/$b:refs/remotes/origin/$b"
  git config --get-all remote.origin.fetch | grep -qxF "$spec" || git config --add remote.origin.fetch "$spec"
  git fetch -q origin "$b"
  git branch -q --set-upstream-to="origin/$b" "$b"
}

case "$cmd" in
  repo)
    repo_name
    ;;
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
    repo="$(repo_name)"
    b="$(current_branch)"
    gh api "repos/$repo/pulls" -f title="$title" -f head="$b" -f base=main -F body=@"$body" --jq .html_url
    ;;
  checks)
    repo="$(repo_name)"
    sha="$(git rev-parse "${1:-HEAD}")"
    gh api "repos/$repo/commits/$sha/check-runs" --jq '.check_runs[] | [.name, .status, (.conclusion // "-")] | @tsv'
    ;;
  *)
    sed -n '2,13p' "$0"
    exit 1
    ;;
esac
