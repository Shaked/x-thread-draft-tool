# Skill: Agent Branch, PR and CI Workflow

The generic workflow (scope, branch, commit, pull request, reading checks) is in the `pr-workflow` plugin:
`plugins/pr-workflow/skills/pr-workflow/SKILL.md`. Read it first. Its helper is `scripts/agent-pr.sh` here,
which calls the plugin helper; `smoke` is this repo's.

## This repo's rules
- Planning: write it in the epic or task issue on GitHub, not in files. No code in a planning session.
- Implement only a task the owner names. A bare "go" applies to the last thing asked; if that was a question with
  more than one open item, ask which.
- A task issue whose change an AI app or assistant sees or uses has the line
  `Clients and languages: <clients> / EN, HE; matrix rows: <rows>` (rows of `docs/architecture/client-matrix.md`).
- Every pull request adds one `docs/changelogs/YYYYMMDD-HHMMSS-<slug>.md` file (UTC).
- Merge (merge commit) only when checks are green and Opus approved the pull request. The owner gave this as a
  standing permission (see AGENTS.md); the deploy to production follows.
- Create the pull request only when the task says so, and check the pull request template first.

## Deployed smoke test
- `scripts/agent-pr.sh smoke [sha]` prints the deployed smoke steps.
- Production runs everything with `XT_SMOKE_TOKEN_PRODUCTION`. Preview deployments run public steps only (`SKIP` on
  account steps is expected): each preview gets its own Neon branch with no smoke-test user, and
  `x-thread-draft-tool-preview.vercel.app` is a manually pinned alias. A `401` on account steps of a preview means
  the workflow lost that rule.
