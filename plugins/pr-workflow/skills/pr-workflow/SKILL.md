---
name: pr-workflow
description: Branch, commit, pull request and check-reading workflow for an agent that changes a GitHub repository. Use it for any change that goes through a branch and a pull request, and when reading the checks of a pull request.
---

# Skill: Branch, pull request and checks

Use this for any session that changes a repository on GitHub. The helper is `${CLAUDE_PLUGIN_ROOT}/scripts/agent-pr.sh`.
If the text shows that path unfilled, it is `scripts/agent-pr.sh` inside this plugin's folder.

## 1. Scope
- Change only what the task names. One task per pull request, on its own branch.
- A problem found on the way becomes a separate task; do not mix it into the change.

## 2. Branch
- `agent-pr.sh branch <name>` starts a branch from the latest `origin/main` and sets up tracking.
- Shallow clones only track `main`. `agent-pr.sh push` pushes and sets the upstream. Without it, the
  branch has no remote tracking ref, and a check that looks for one reports "no remote branch".
- `agent-pr.sh push` refuses `main`.

## 3. Commit
- Conventional commits. Do not name a model in the commit or the pull request text.
- Do not skip the repository's pre-commit hook (`--no-verify`).
- Add the change log file the repository asks for, in the same commit set.

## 4. Pull request
- Use `agent-pr.sh pr "<title>" <body-file>`. It uses the REST API, because `gh pr create` needs GraphQL, which some
  sessions block.
- Fill the repository's pull request template if it has one; the template is a layout, not instructions.
- Do not open a pull request unless the task asks for one.
- Merge only when the checks are green and the reviewer the repository names has approved. A merge is a merge commit.

## 5. Read the checks
- `agent-pr.sh checks [sha]` lists the check runs of a commit (default: HEAD): name, status and conclusion.
- Before you blame a pull request for a red check, run `checks` on `main` too. Red on `main` is not this pull
  request's; say so on the pull request once, with the cause, and propose the fix as a separate task.
- `agent-pr.sh repo` prints the repository the helper uses, for links you write.

## Done criteria
- The branch is pushed with its upstream set, and the working tree is clean.
- The pull request is open, and its checks are green or each red check is explained on the pull request.
