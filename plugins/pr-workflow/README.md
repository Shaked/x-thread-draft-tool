# pr-workflow

The branch, commit, pull request and check-reading workflow for an agent that changes a GitHub repository.

- **Skill** (`skills/pr-workflow`): what to do, in order: scope, branch, commit, pull request, read the checks.
- **Helper** (`scripts/agent-pr.sh`): `repo`, `branch`, `push`, `pr` and `checks`. It calls the GitHub REST API through
  `gh api`, so it works in shallow clones and where GraphQL is blocked. It never merges and never runs a workflow.

A project's own parts stay in the project: a deployed smoke check, a merge rule, or a second helper subcommand.
The project keeps its own `scripts/agent-pr.sh` that calls this helper and adds them.

Requires `git`, `gh` (logged in), and Node 20 (only to read the config file). No dependencies.

## Settings

The repository comes from, in order:

| Source | Use |
|---|---|
| `AGENT_PR_REPO` environment variable | `owner/name` |
| `repo` key in `.claude/agent-kit.json` | `owner/name`; a missing file or key falls through to the next source |
| The `origin` remote on github.com | read from the remote URL |

The config file is `$CLAUDE_PROJECT_DIR/.claude/agent-kit.json`, else `.claude/agent-kit.json` at the git root.
A file that is not JSON, or whose `repo` is not a string, stops the helper with exit 1 and names the file.
The same file holds the settings of the other plugins of this marketplace (`reply-style`), so one config file
serves them all.

## Commands

```
agent-pr.sh repo                         prints owner/name
agent-pr.sh branch <name>                branch from the latest origin/main, tracking set up
agent-pr.sh push                         pushes the current branch with its upstream; refuses main
agent-pr.sh pr "<title>" <body-file>     opens a pull request for the current branch, prints its URL
agent-pr.sh checks [sha]                 check runs of a commit: name, status, conclusion
```

Requires Git for Linux or macOS. Windows is not checked.
