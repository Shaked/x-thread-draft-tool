Janitor report, <YYYY-MM-DD>: <n> sessions read in <n> pages, <n> in scope,
<n> issues read, <n> findings (counts checked).

| Finding kind | Count |
|---|---|
| <Kind label> (`<kind>`) | <n> |

## TL;DR
The janitor matched <n> sessions in scope with their issues: <n> findings, <n> fixes applied (checked).
<"<n> findings are for the dispatcher, listed below." or "No finding is for the dispatcher.">
<"Nothing needed from you." or "You need to do N things (below).">

## What you need to do
Nothing.

<Or one numbered step per `owner` finding, with its issue.>

## Waiting for
- [#154 dispatcher queue issue](https://github.com/Shaked/x-thread-draft-tool/issues/154): acts on the <n> `dispatcher` findings below.
  Expected: its next pass, time not known.
- For an agent session: [<task, 3 to 6 words>](<task link>) · [session](https://claude.ai/code/session_<id>): <what it is doing>. Expected: <time, or "not known">.

<Or "Nothing.">

## Blocked on you
Nothing.

<Or one line per `owner` finding.>

## Done
- Read <n> sessions in <n> pages (`has_more` false) and <n> issues, checked.
- Checked the <n> sessions tagged `pipeline` or `epic-<n>` and their dispatcher; the others belong to other projects.
- #<n> (<issue, 3 to 6 words>): <fix applied>, checked.

<Or "- No fix applied in this run.">

## Details
### Findings
| Kind | Session | Issue | Evidence | Proposed action |
|---|---|---|---|---|
| <Kind label> | [`<session id>`](https://claude.ai/code/<session id>) | [#<n> (<issue, 3 to 6 words>)](<issue link>) | <evidence> | <proposed action> `<allowed, dispatcher or owner>` |

### Pass 1 report (task janitor)
For a duplicate pair, the `duplicate-issue` row above wins over the fix written below.

<The output of `node scripts/janitor.mjs report`, when the run includes it.>
