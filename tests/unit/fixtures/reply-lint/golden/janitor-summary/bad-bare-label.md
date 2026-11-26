Janitor report, 2026-11-26: 14 sessions read in 1 page, 13 in scope,
13 issues read, 13 findings (counts checked).

| Finding kind | Count |
|---|---|
| Done, issue open (`done-open`) | 2 |
| Done, no HANDOFF (`no-handoff`) | 1 |
| Failed or needs input (`stuck`) | 2 |
| Review-ready, PR open (`nudge-merge`) | 2 |
| Orphan session (`orphan-session`) | 1 |
| Orphan claim (`orphan-claim`) | 1 |
| Duplicate sessions (`duplicate-session`) | 1 |
| Duplicate issues (`duplicate-issue`) | 1 |
| Stale session (`stale`) | 2 |

## TL;DR
The janitor matched 13 sessions in scope with their issues: 13 findings, 1 fix applied (checked).
12 findings are for the dispatcher, in the table below.
Nothing needed from you.

## What you need to do
Nothing.

## Waiting for
- [#154 dispatcher queue issue](https://github.com/example/repo/issues/154): acts on the 12 `dispatcher` findings below.
  Expected: its next pass, time not known.

## Blocked on you
Nothing.

## Done
- Read 14 sessions in 1 page (`has_more` false) and 13 issues, checked.
- Checked the 13 sessions tagged `pipeline` or `epic-<n>` and their dispatcher; the others belong to other projects.
- #101: closed as completed after reading its HANDOFF, checked.

## Details
### Findings
| Kind | Session | Issue | Evidence | Proposed action |
|---|---|---|---|---|
| Done, issue open | `session_done` | #101 | session `completed`; the last HANDOFF says done and has RELEASE; PR #201 (Export button issue) is merged; matched by title and claim. | Close #101 as completed after reading its HANDOFF. `allowed` |
| Done, issue open | `session_merged` | #102 (`E100` task `A2` import screen) | session `review_ready`; merged PR #202 (Import screen issue) names it; no done HANDOFF; matched by title. | Read the PRs and the issue: close it, or write in the issue what is left. `dispatcher` |
| Done, no HANDOFF | `session_nohand` | #103 (`E100` task `A3` share link) | session `completed`; no HANDOFF comment; no open PR names it; matched by title. | Ask the session to post its HANDOFF with RELEASE. `dispatcher` |
| Failed or needs input | `session_failed` | #104 (`E100` task `A4` undo stack) | session `failed`: its last turn failed; model `claude-haiku-5-5`; last: `npm ci failed / disk full`. | Resume: send "continue from your last step" once; failed twice, a new session with Sonnet on the same branch. `dispatcher` |
| Failed or needs input | `session_asks` | #105 (`E100` task `A5` draft search) | session `blocked`, it asks: `pick the search ranking; my token [redacted] is in the log`. | Decide: read its last message and answer it; an owner-only matter goes to Shaked with the label `owner`. `dispatcher` |
| Review-ready, PR open | `session_review` | #106 (`E100` task `A6` tag filter) | session `review_ready` for 6 hours; PR #206 (Tag filter issue): checks `red`, 1 open Codex thread. | Nudge it: fix the red checks and answer the Codex threads, then merge. `dispatcher` |
| Review-ready, PR open | `session_paused` | #112 (`E100` task `B2` paused work) | session `review_ready` for 144 hours; PR #212 (Paused work issue): checks not read. | Nudge it to merge once Opus has judged the final head. `dispatcher` |
| Orphan session | `session_orphan` | none | session `working`; no issue number in its title, no CLAIM or HANDOFF names it. | Read it: link it to its issue with a CLAIM, or archive it once it is completed. `dispatcher` |
| Orphan claim | `session_gone` | #107 (`E100` task `A7` theme switch) | #107 has a CLAIM with no RELEASE; its session is not in the dump (archived, gone, or left out): check it with `get_session` before a release. | Dispatcher watchdog: check the session with `get_session`, then resume it, start a new one, or release the claim. `dispatcher` |
| Duplicate sessions | `session_dupa`, `session_dupb` | #108 (`E100` task `A8` word count) | 2 sessions match it: `working`, `working`. | Dispatcher: keep `session_dupa`, named in the live CLAIM; archive the others only once they are completed. `dispatcher` |
| Duplicate issues | `session_print` | #110 (`E100` task `A9` print view) | #109 (`E100` task `A9` print view) and #110 have the same title; 1 session matches them. | Read both; if the bodies match, close #110 as a duplicate of #109 with a comment. `dispatcher` |
| Stale session | `session_old` | #111 (`E100` task `B1` old fix) | session `completed`; no update for 10 days. | Can be archived: it is completed. `dispatcher` |
| Stale session | `session_paused` | #112 | session `review_ready`; no update for 6 days. | Not completed, so never archive it: read why it stopped. `dispatcher` |
