---
name: reply-style
description: Templates and hard rules for every reply to Shaked (the owner), every HANDOFF comment and every owner question. Use it before you post a status, a handoff, a question, a manual step or an incident report, in chat or on GitHub.
---

# Skill: Reply style (templates for replies to the owner)

Shaked reads replies without the context you have. Every reply to him, every HANDOFF and every
owner question uses one template below, follows the hard rules, and passes the lint.

## Which template
| You are writing | Template | Where it goes |
|---|---|---|
| A task shipped, or a dispatcher pass ended | [`status-report`](templates/status-report.md) | Chat reply to Shaked |
| One decision only Shaked can make | [`owner-question`](templates/owner-question.md) | A comment on the epic; one question per comment |
| A task session ends | [`handoff`](templates/handoff.md) | A comment on the task issue, last |
| A step Shaked must do by hand | [`owner-action`](templates/owner-action.md) | Chat reply, and a comment on the issue it unblocks |
| Something failed (CI, deploy, production, a session) | [`incident`](templates/incident.md) | Chat reply, and a comment on the issue or PR |

A reply that fits two kinds uses one template and puts the other part under its headings.
Example: a status report with a question puts the question under `Blocked on you`, with the
parts of the `owner-question` template as `###` subheadings.

## The fixed headings
Every template has these `##` headings, with these names and in this order. Kinds add their own
headings or `###` subheadings, but never rename, reorder or drop these:

1. `TL;DR`: 1 to 3 lines. What happened, then "Nothing needed from you." or "You need to do N things".
2. `What you need to do`: numbered steps (1, 2, 3), one action each, with a link or the exact words
   to type in a code span. Or "Nothing." The number of steps matches the TL;DR.
3. `Waiting for`: agents, sessions, CI runs and systems. Each with a link, what it is doing, and the
   expected time (or "not known"). Or "Nothing."
4. `Blocked on you`: only a decision or action that a human must do. Or "Nothing."
5. `Done`: what shipped, with PR and issue links, and the evidence: "checked" (you read it) or
   "not checked".
6. `Details`: optional and short. Leave it out when empty.

## Hard rules
Each rule can be checked by reading the reply.

1. **No context needed.** The first time a reply names a label (an issue or PR number, a task id
   such as Q1, T7 or S2), it has a link and 3 to 6 words saying what it is:
   `[#279 tool text wording](https://github.com/Shaked/x-thread-draft-tool/issues/279)`.
   On GitHub, `#279 (tool text wording)` also works, because GitHub links `#279` itself.
   In chat, always use the full link.
2. **Never write "unchanged" or "still open" alone.** Say what the item is, its state, and what
   happens next: "The margin question on #279 (tool text wording) has no answer yet. Its default
   applies on 2026-11-24."
3. **A question has all of these:** what is decided, in one sentence, in terms of what a user sees;
   each option, named by what it does, with what happens; the recommendation and why; what happens
   if nobody answers; and where to answer (a link and the exact words to type). Never name options
   by letters only (A, B or C). Ask only what the owner alone can decide: money, secrets, deleting
   data, product behaviour the task does not decide.
4. **"Blocked" means a human.** Only a human decision or action goes under `Blocked on you`.
   Everything else (agents, sessions, CI, Vercel, a usage limit) is `Waiting for`, with a link,
   what it waits for, and the expected time.
5. **Same item, same words.** Copy how you named an item last time, and keep the order of the
   facts. Change only the part that changed. Every number says "checked" (you read it) or
   "not checked".
6. **Show, do not describe.** Link issues, PRs and runs. Put commands, ids, shas and exact text to
   type in code spans or code blocks. Use a table only for 3 or more comparable items. Write simple
   technical English: short sentences, lines under 160 characters.
7. **No slop, no emoji.** See the slop check. No model names in commit messages or PRs.
8. **A manual step** says what to click, where (a link), what it unblocks, and which automated
   route failed. Use the `owner-action` template.

## Slop check
Three writing skills from pstack, the plugin Shaked chose, are in this repo (source and licence:
`THIRD_PARTY_LICENSES/pstack.md`). Read the file and apply it; they are not loaded on their own:

- Every reply: apply [`pstack-unslop`](../pstack-unslop/SKILL.md) before you post.
- PR bodies, commit messages and HANDOFF comments: also apply
  [`pstack-technical-writing`](../pstack-technical-writing/SKILL.md).
- Shaked says he did not understand a reply: rewrite it with [`pstack-bro`](../pstack-bro/SKILL.md),
  then put it back into the template.

When a pstack rule and this skill disagree, this skill wins. Example: a label explained in
parentheses, `#279 (tool text wording)`, is allowed even though unslop rule 13 limits parentheses.

Before you post, read the reply once as a stranger and check:
- Every label has a link and 3 to 6 words the first time.
- The TL;DR alone tells Shaked whether he must act.
- Each step is one action he can do without asking you anything.
- No filler: no "I hope this helps", "great question", "seamless", "leverage", "delve", "it's worth noting".
- No hedging stacks ("it seems that it might"): state the fact, or write "not checked".
- No sentence repeats another one in different words.
- Nothing is announced and then not done ("I will now...").

Then run the lint. It flags bare labels, letter options, "unchanged", "blocked" next to a
non-human, "waiting for you", long lines, emoji, filler phrases, and missing or reordered headings:

```sh
npm run reply-lint -- reply.md              # a templated reply (headings are checked)
npm run reply-lint -- --template reply.md   # force the heading checks
```

Fix every finding, then post. The script is `scripts/reply-lint.mjs`; its tests are
`tests/unit/reply-lint.test.js`. CI also runs it on every PR body, warn only for now
(`.github/workflows/reply-lint.yml`).

## How this skill is updated
The weekly improvement review (task #294; rules in `docs/operations/weekly-review.md` once it ships)
updates this skill and its templates in the same run as its findings, in its "skill" PR. It also
checks `cursor/plugins` for a newer pstack and opens an issue for it; it never updates the
vendored files on its own.
