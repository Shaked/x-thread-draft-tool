# task-janitor

Reads an issue tracker and the Claude Code sessions that work on it, then reports what is done but open, stuck, duplicated,
orphaned or waiting for the owner. It never writes to GitHub and never resumes or messages a session.

- **Pass 1** (`scripts/janitor.mjs`): duplicates, shipped-but-open issues, dependencies, stale and orphaned tasks, limits, labels.
- **Pass 2** (`scripts/session-janitor.mjs`): matches sessions with issues by the `#NNN` in a title, a `CLAIM` comment or a HANDOFF,
  and finds done-but-open, stuck, orphaned and duplicate work.
- **Status board** (`scripts/status-board.mjs`): one page of tickets, pull requests and sessions, and whether the owner is needed.
- **Skill** (`skills/task-janitor`): the rules for acting on the report, the session dump shape (`sessions.schema.json`) and
  two templates: `janitor-summary` and `status-board`.
- **Commands** (`commands/janitor.md`, `commands/status.md`): `/janitor` runs both passes and posts the summary; `/status` prints the board.

The scripts are Node 20 with no dependencies. The only network call is `gh` search in `fetch` (it reads GitHub; needs a token
the `gh` CLI can use). `analyze()` and the formatters are pure and tested offline.

## Settings

Settings are in `.claude/agent-kit.json` at the project root, in the `task-janitor` section and two shared keys. The scripts
find the file at `$CLAUDE_PROJECT_DIR/.claude/agent-kit.json`, else by walking up from the working folder. A missing file or
key means the default. A broken file stops a command with exit 2 and names the key.

| Key | Default | Use |
|---|---|---|
| `repo` | empty | The repository, `owner/name`, for the GitHub search in `fetch` |
| `owner` | `the owner` | The owner's name in findings and in the owner patterns (the owner's comments count as answers) |
| `task-janitor.replyLint` | not set | A path from the project root to the reply-style lint module (`lint(text, options)`). Not set: the report says "Reply style: not checked" |
| `task-janitor.manualTestsIssue` | not set | A whole number. The issue whose tests are optional on the status board; not set: no such issue |
| `task-janitor.reportIssue` | not set | A whole number. The standing issue the `/janitor` summary is posted on; not set: `/janitor` prints the summary and posts nothing |
| `task-janitor.dispatcherIssue` | not set | A whole number. The issue that queues work for a dispatcher agent; named in the summary when set |

Fixed conventions, not settings (documented in the skill): the labels `held`, `owner`, `parked`, `cleanup`, `weekly`,
`reply-style-fail`, `epic`, `task`, `dispatch`, `janitor` and `tracker`; the markers `CLAIM`, `HANDOFF` and `RELEASE`; the
file names that are not counted as code (`IGNORED_FILES` in `scripts/janitor.mjs`).

Example:

```json
{
  "owner": "Sam",
  "repo": "acme/sample-app",
  "task-janitor": {
    "reportIssue": 12,
    "replyLint": "plugins/reply-style/scripts/reply-lint.mjs"
  }
}
```

## Install

After the marketplace is public (see the marketplace docs). `<owner>/<repo>` is the GitHub repository that holds the marketplace:

```
/plugin marketplace add <owner>/<repo>
/plugin install task-janitor@agent-kit
```

Node 20 is needed on the machine that runs the scripts. A project that installs this plugin should not also copy the
scripts into its own `scripts/` folder.

## Licence

MIT. The copy of the licence is in `LICENSE` in this folder.
