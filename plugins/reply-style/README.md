# reply-style

Reply templates and hard rules for an agent that reports to the owner of a repository.

- **Skill** (`skills/reply-style`): the rules and five templates: status report, owner question, handoff,
  owner action and incident. Every template has the same fixed `##` headings in the same order.
- **Lint** (`scripts/reply-lint.mjs`): checks one reply against the rules. Exit 1 with findings, exit 2 with a broken config.
- **Stop hook** (`hooks/hooks.json`): when `REPLY_STYLE=owner` is set in the environment, checks the reply at the
  end of each turn and asks the agent to rewrite a reply that fails. It never blocks twice in a row.
- **Comment lint** (`scripts/reply-lint-comment.mjs`): checks an agent's GitHub comment written for the owner.

Requires Node 20. No dependencies.

## Settings

Settings are in `.claude/agent-kit.json` at the project root. The lint and the hook find it at
`$CLAUDE_PROJECT_DIR/.claude/agent-kit.json`, else by walking up from the working folder to the folder with `.git`.
A missing file or key means the default. A broken file stops the command-line lint with exit 2 and names the key;
the Stop hook prints a warning and lets the turn end.

| Key | Default | Use |
|---|---|---|
| `owner` | `the owner` | The name the skill tells the agent to use for the owner, and the name in the Stop hook message |
| `ownerLogin` | empty | The owner's GitHub login, for tools that need to know which author is the owner |
| `repo` | empty | The repository, `owner/name`, for tools that build links |
| `reply-style.humans` | `the owner` | Words after "blocked on" and "waiting for" that mean a person. `you`, `your` and `owner` always count, so the fixed heading "Blocked on you" passes |
| `reply-style.allowLines` | `[]` | Regular expressions for lines the lint skips, such as a required PR body line |
| `reply-style.maxLineLength` | `160` | The longest line the `long-line` rule allows |
| `reply-style.changelogAreas` | `[]` (any one word) | The allowed `Area:` values of a changelog entry |
| `reply-style.extraTemplates` | `{}` | Project templates the skill lists next to its own, by kind and path |
| `reply-style.writingSkills` | `[]` | Writing skills the skill tells the agent to apply, by name |

Example:

```json
{
  "owner": "Sam",
  "repo": "acme/sample-app",
  "reply-style": {
    "humans": ["Sam", "the owner"],
    "allowLines": ["^Implements #\\d+ Task "],
    "maxLineLength": 160
  }
}
```

The Stop hook is opt-in: set `REPLY_STYLE=owner` in the shell that starts the agent.
