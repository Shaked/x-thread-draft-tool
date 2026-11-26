---
name: metrics-emit
description: Join a central metrics service with a repository: the one-line change, the event shape, its caps, what never goes in, the dry run.
---

# Skill: Emit metrics

A central metrics service stores events about CI runs, merges, deploys, speed stages and production errors, and
answers questions about them. A repository does not push anything. The service's own scheduled workflow reads the
public GitHub API for every repository on its source list. Joining means one line on that list.

## Before you start
0. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/metrics-config.mjs"`. It prints the four project values from the
   `metrics` section of `.claude/agent-kit.json`: `app` (the name of the app that holds the service), `repo`
   (`owner/name` of the repository whose numbers are sent), `siteUrl` (the site that serves the admin API) and
   `ingestUrl` (the address that receives event batches). Exit 1 means a value is missing: set it, then run it again.
   When this text shows `${CLAUDE_PLUGIN_ROOT}` unfilled, the script is `scripts/metrics-config.mjs` two folders
   above this file.

## How a repository joins
1. Only a public repository can join. A private one would need a read token, which the service does not use.
2. Add one entry to the service's source list, by a pull request to the service's repository: `owner`, `name`, the
   numeric `repository_id`, and `workflows`, the exact `name:` of each workflow that gets rows. Read the id from the
   `id` field of `GET https://api.github.com/repos/<owner>/<name>`. Add `speed: true` only when the service knows
   the repository's workflow names.
3. Nothing changes in the joining repository: no workflow, no token, no permission, no secret.
4. A run of a workflow that is not listed, and every skipped or cancelled run, is only counted per UTC day. It
   gets no row.

## What an event looks like (version 1)
```json
{
  "v": 1,
  "repo_id": 1234567,
  "events": [
    {
      "source": "ci", "kind": "run", "id": "45713676980.1", "at": "2026-11-25T22:29:45Z",
      "name": "Tests", "status": "failure", "ms": 97000,
      "attrs": { "event": "pull_request", "queue_ms": 2000, "failed_job": "Unit tests", "failed_step": "Install packages" },
      "link": "https://github.com/acme/sample-app/actions/runs/45713676980"
    }
  ]
}
```
Example values. The batch goes to `ingestUrl` with `POST`. The unique key is repo, source, kind and `id`, so an event
sent twice is stored once.

| source / kind | id | name | status | ms | attrs keys |
|---|---|---|---|---|---|
| `ci` / `run` | run id, attempt | a listed workflow | `success`, `failure`, `timed_out` | run time | `event`, `queue_ms`, `failed_job`, `failed_step`, `pr` |
| `git` / `merge` | merge commit | the base branch | `merged` | PR open to merge | `pr`, `files`, `docs_only` |
| `speed` / `merge` | merge commit and stage | `ci`, `merge_wait`, `vercel`, `smoke`, `total` | `ok`, `over` | stage time | `limit_ms`, `pr` |
| `deploy` / `deploy` | deployment id | `Production` or `Preview` | `success`, `failure` | created to success | `sha` |
| `prod` / `error` | a random id | route template, or `unmatched` | HTTP status, 4xx or 5xx | request time | `error`, `code`, `region`, `tool` |

Caps, as the service enforces them (its ingest code is the truth):
- `at` is an ISO time between 14 days ago and 10 minutes from now. `ms` is a whole number from 0 to 2147483647, or left out.
- `id` is at most 120 characters, else the event is refused. A wrong type for `ms` or `status`, or a `status` outside the table, also refuses it.
- `attrs` keeps only the keys in the table, cuts each string to 120 characters, and must fit in 1 KB, else the event is refused.
- `link` is kept only when it starts with `https://github.com/<owner>/<name>/` of the same repository, is at most 120
  characters and has no `..`, `%2e` or `\`. Otherwise it is dropped and the event is stored without it.
- A `name` over 120 characters, or one the service does not list, is stored as `other`. For `ci` the list is the repository's
  workflows; for the other kinds it is fixed: the base branch, the stage names, `Production` and `Preview`.
- A batch holds at most 500 events (413). A repository gets at most 5000 events and 200 counter rows per UTC day (429).
  Over 100000 stored rows, new events are refused (503).
- The ingest route accepts only the identity token of the service's own scheduled workflow, from its default
  branch. A project never posts by hand and never creates a token or a secret for this.

## What never goes in
Secrets, tokens, user data (names, emails, ids of people), real paths that hold ids, log text, commit or pull
request bodies, and error messages (an error message can hold user data: send the class name and a short code).
The log stays where it is: the event holds a link to it.

## A web app's own runtime numbers
The service does not take request numbers from other apps. An app that wants them keeps a rollup in its own database:
- One row per hour and route template (`GET /items/:id`, never the real path), with counts by status class, cold
  starts, time sums and a fixed histogram of 65 latency buckets.
- Write the row after the answer is sent, and only when the request already used the database. A request that used
  no query waits in memory for the next one that does, so a health check never wakes the database.
- A failed write never changes the answer. A setting turns the write off.
- Move rows older than 14 days into a daily table. Delete daily rows after 400 days.

## Check it: dry run
1. The service's collector has a flag, `--dry-run --repo <owner/name>`, that prints the batches it would send and
   sends nothing. It needs `GITHUB_TOKEN` with read access in the environment. Run it for `repo` from the config, on the
   branch of your pull request: before the new source entry exists it stops with "no listed repo matches".
2. Read the output: `repo_id` is the listed id; each event is in the table above; names are the listed workflows; no
   link leaves the repository; the counts are under the caps; no event holds log text or a person's data.
3. After the pull request merges, the next scheduled run stores the events (every 6 hours when this was written), or run the collector
   workflow by hand. Then read the service's summary for that repository through its admin tools to confirm it shows up.
