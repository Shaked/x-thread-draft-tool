---
name: reply-style
description: Templates and hard rules for every reply to Shaked (the owner), every HANDOFF comment and every owner question. Use it before you post a status, a handoff, a question, a manual step or an incident report, in chat or on GitHub.
---

# Skill: Reply style (templates for replies to the owner)

Shaked reads replies without the context you have. Every reply to him, every HANDOFF and every
owner question uses one template below, follows the hard rules, and passes the lint.

## Before you send
1. Start from the template file for your kind. The `##` headings come first, in this order: `TL;DR`,
   `What you need to do`, `Waiting for`, `Blocked on you`, `Done`, then `Details`.
2. No loose bold or plain labels such as `**Done:**`, `Not done:` or `Blocked on you:`. Use the `##` heading.
3. `What you need to do`, `Waiting for` and `Blocked on you` say "Nothing." when empty. `Done` always has content with "checked" or "not checked". Leave `Details` out when it is empty.
4. Every label (`#279`, `Q1`) has a link and 3 to 6 words the first time. Never "unchanged" alone.
5. Run `npm run reply-lint -- --template reply.md` and fix every finding before you send.
   A session started with `REPLY_STYLE=owner` in its environment is also checked when the turn ends: the Stop hook
   returns the failing rules and you rewrite the reply (setup: `docs/operations/reply-style.md`).

## Which template
| You are writing | Template | Where it goes |
|---|---|---|
| A task shipped, or a dispatcher pass ended | [`status-report`](templates/status-report.md) | Chat reply to Shaked |
| One decision only Shaked can make | [`owner-question`](templates/owner-question.md) | A comment on the epic; one question per comment |
| A task session ends | [`handoff`](templates/handoff.md) | A comment on the task issue, last |
| A janitor run (`/janitor`) | [`janitor-summary`](templates/janitor-summary.md) | A comment on #497 (Janitor reports tracker issue); written by `scripts/session-janitor.mjs report` |
| A step Shaked must do by hand | [`owner-action`](templates/owner-action.md) | Chat reply, and a comment on the issue it unblocks |
| Something failed (CI, deploy, production, a session) | [`incident`](templates/incident.md) | Chat reply, and a comment on the issue or PR |
| Anything else to Shaked: a reminder, a progress note, an answer to his question | [`status-report`](templates/status-report.md) | Chat reply, or a comment where he asked |
| A changelog file for a PR | [`changelog-entry`](templates/changelog-entry.md) | `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md`; the app shows it to users |
| The text of a Telegram notice | [`telegram-message`](templates/telegram-message.md) | Target format: `scripts/notify-telegram.mjs` sends the old text until task #369 changes it |

A reply that fits two kinds uses one template and puts the other part under its headings.
Example: a status report with a question puts the question under `Blocked on you`, with the
parts of the `owner-question` template as `###` subheadings.

- **Several questions in one reply:** one `###` subheading per question under `Blocked on you`.
  Inside it, write each part as a bold label: **What is decided:**, **Options:**,
  **Recommendation:**, **If nobody answers:**, **Where to answer:**. One numbered step per question
  under `What you need to do`.
- **A reminder of a question already posted:** give its name, the decision in one line, the exact
  reply words, the default, and a link to the full question. Do not restate every option.
- **On GitHub:** end the comment with the Claude Code footer that `AGENTS.md` asks for, after
  `RELEASE` in a handoff.

## Changelog entries and Telegram messages
These two are read by people outside the work, so they have their own shape and no fixed headings.
Apply `pstack-unslop` and `pstack-technical-writing` to both.

- **Changelog entry:** a `#` title that says what changed for a person, in 3 to 8 words, then 1 to 5
  short lines. The app shows the title and the first three lines, cut at 280 characters, so the most
  useful line goes first and the first three lines stay short.
  Plain words only: no issue numbers, task ids, file names or code spans. Say what a person can now
  do or see, not how it was built.
- **Telegram message (target format):** the script sends these forms (issue #463).
  The template is Markdown; the script turns it into HTML. One message per event, at most 5 lines.
  Line 1 is one emoji, then the headline in bold, linked, saying what happened. Then the item, one
  fact when the kind has one, `Needs you:` with one action (left out when nothing is needed), and other links.
  Never a secret, a login name, draft text or log output (`docs/operations/telegram.md`).
- Check them with `npm run reply-lint -- --kind=changelog <file>` or `--kind=telegram <file>`.

## The fixed headings
Every reply template has these `##` headings, with these names and in this order. Kinds add their own
headings or `###` subheadings, but never rename, reorder or drop these:

1. `TL;DR`: 2 to 3 lines. What happened, then "Nothing needed from you." or "You need to do N things".
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
   if nobody answers; and where to answer (a link and the exact words to type). For a decision
   about the repo, say what Shaked sees (for example red checks). When only he knows the answer,
   write "Recommendation: none (only you know)". Never name options
   by letters only (A, B or C). Ask only what the owner alone can decide: money, secrets, deleting
   data, product behaviour the task does not decide.
4. **"Blocked" means a human.** Only a human decision or action goes under `Blocked on you`.
   Everything else (agents, sessions, CI, Vercel, a usage limit) is `Waiting for`, with a link,
   what it waits for, and the expected time.
5. **Same item, same words.** Copy how you named an item last time, and keep the order of the
   facts. Change only the part that changed. Every measured or reported number (a time,
   a count, a size, a price) says "checked" (you read it) or "not checked". Constants, dates
   and step numbers do not.
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
