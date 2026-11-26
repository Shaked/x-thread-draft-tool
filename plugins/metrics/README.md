# metrics

Skills for an agent that works with a central metrics service: a place that stores events about CI runs, merges,
deploys, speed stages and production errors, and answers with a plain-line summary through an admin API and MCP tools.

- **Skill `metrics-emit`**: how a repository joins the service (one line on its source list), the event shape
  (version 1) and its caps, what never goes into an event, the rollup pattern for a web app's own numbers, and the dry run.
- **Script `scripts/metrics-config.mjs`**: prints and checks the project's four values. Exit 1 when one is missing,
  exit 2 when the file is broken.

Requires Node 20. No dependencies. No network access: the skills tell the agent what to call, the plugin calls nothing.

## Settings

One section, `metrics`, in `.claude/agent-kit.json` at the project root. The script finds the file at
`$CLAUDE_PROJECT_DIR/.claude/agent-kit.json`, else by walking up from the working folder to the folder with `.git`.
`repo` falls back to the top-level `repo` key that other agent-kit plugins use.

| Key | Use |
|---|---|
| `metrics.app` | The name of the app that holds the metrics service, for reports |
| `metrics.repo` | `owner/name` of the repository whose numbers are sent or read |
| `metrics.siteUrl` | `https://` address of the site that serves the admin API and pages |
| `metrics.ingestUrl` | `https://` address that receives event batches with `POST` |

Example:

```json
{
  "metrics": {
    "app": "Sample app",
    "repo": "acme/sample-app",
    "siteUrl": "https://sample-app.example.com",
    "ingestUrl": "https://sample-app.example.com/api/ops/events"
  }
}
```

The service itself is not part of this plugin. The plugin only describes how to join it and how to read it.
