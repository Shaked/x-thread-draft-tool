---
name: reply-style
description: Templates and hard rules for replies an agent writes to the owner of a repository: a status report, an owner question, a handoff, a manual step or an incident report, in chat or on GitHub. Use it before you post any of these.
---

# Skill: Reply style (templates for replies to the owner)

The owner reads replies without the context you have. Every reply to the owner, every handoff and every
owner question uses one template below, follows the hard rules, and passes the lint.

## Before you send
0. Read `.claude/agent-kit.json` at the project root if it exists. Its `owner` key is the owner's name: use it
   where this skill says "the owner". Its `reply-style.extraTemplates` lists project templates, with their
   paths, for kinds this skill does not cover: use them for their kind. Its `reply-style.writingSkills` lists
   writing skills to apply (see the slop check). A missing file or key means: no name, no extra templates, no
   writing skills.
1. Start from the template file for your kind. The `##` headings come first, in this order: `TL;DR`,
   `What you need to do`, `Waiting for`, `Blocked on you`, `Done`, then `Details`.
2. No loose bold or plain labels such as `**Done:**`, `Not done:` or `Blocked on you:`. Use the `##` heading.
3. `What you need to do`, `Waiting for` and `Blocked on you` say "Nothing." when empty.
   `Done` always has content with "checked" or "not checked". Leave `Details` out when it is empty.
4. Every label (`#12`, `Q1`) has a link and 3 to 6 words the first time. Never "unchanged" alone.
5. A `Waiting for` item that is an agent session shows the task link and the Claude session link side by side:
   `[#<n> <3 to 6 words>](<issue link>) · [session](https://claude.ai/code/session_<id>)` (rule `session-link`).
   The link has the shape the commit attribution uses. Whether it opens in the Claude app is not checked.
6. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/reply-lint.mjs" --template reply.md` and fix every finding before you send.
   The script is `scripts/reply-lint.mjs` in the plugin folder, two folders above this file. When this text shows
   `${CLAUDE_PLUGIN_ROOT}` unfilled, use that path, or the project's own command if it names one.
   A session started with `REPLY_STYLE=owner` in its environment is also checked when the turn ends: the Stop hook
   returns the failing rules and you rewrite the reply.
7. The lint rules, by name, so that each one is on this list: `bare-label`, `option-letters`, `unchanged`, `blocked`,
   `waiting-human`, `long-line`, `emoji`, `slop`, `headings`, `loose-label`, `empty-details`, `tldr`, `steps`,
   `session-link`, `evidence`, `internal-label`, `shape`, `app-name`, `empty-section`.

## Which template
| You are writing | Template | Where it goes |
|---|---|---|
| A task shipped, or a work pass ended | [`status-report`](templates/status-report.md) | Chat reply to the owner |
| One decision only the owner can make | [`owner-question`](templates/owner-question.md) | A comment where the work is tracked; one question per comment |
| A task session ends | [`handoff`](templates/handoff.md) | A comment on the task, last |
| A step the owner must do by hand | [`owner-action`](templates/owner-action.md) | Chat reply, and a comment on the item it unblocks |
| Something failed (CI, deploy, production, a session) | [`incident`](templates/incident.md) | Chat reply, and a comment on the item or pull request |
| Anything else to the owner: a reminder, a progress note, an answer | [`status-report`](templates/status-report.md) | Chat reply, or a comment where the owner asked |

Project templates, listed in `reply-style.extraTemplates` of `.claude/agent-kit.json`, cover the other kinds
(a changelog entry, a message to a chat app, a summary report). They are not in this plugin.

A reply that fits two kinds uses one template and puts the other part under its headings.
Example: a status report with a question puts the question under `Blocked on you`, with the
parts of the `owner-question` template as `###` subheadings.

- **Several questions in one reply:** one `###` subheading per question under `Blocked on you`.
  Inside it, write each part as a bold label: **What is decided:**, **Options:**,
  **Recommendation:**, **If nobody answers:**, **Where to answer:**. One numbered step per question
  under `What you need to do`.
- **A reminder of a question already posted:** give its name, the decision in one line, the exact
  reply words, the default, and a link to the full question. Do not restate every option.
- **On GitHub:** end the comment with the footer the project asks for, when it asks for one.

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
   `[#12 tool text wording](https://github.com/acme/sample-app/issues/12)`.
   On GitHub, `#12 (tool text wording)` also works, because GitHub links `#12` itself.
   In chat, always use the full link.
2. **Never write "unchanged" or "still open" alone.** Say what the item is, its state, and what
   happens next: "The margin question on #12 (tool text wording) has no answer yet. Its default
   applies on 2026-11-24."
3. **A question has all of these:** what is decided, in one sentence, in terms of what a user sees;
   each option, named by what it does, with what happens; the recommendation and why; what happens
   if nobody answers; and where to answer (a link and the exact words to type). For a decision
   about the repo, say what the owner sees (for example red checks). When only the owner knows the answer,
   write "Recommendation: none (only you know)". Never name options
   by letters only (A, B or C). Ask only what the owner alone can decide: money, secrets, deleting
   data, product behaviour the task does not decide.
4. **"Blocked" means a human.** Only a human decision or action goes under `Blocked on you`.
   Everything else (agents, sessions, CI, a hosting dashboard, a usage limit) is `Waiting for`, with a link,
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
Apply the writing skills that `reply-style.writingSkills` in `.claude/agent-kit.json` names, read from their
own files. They are not loaded on their own. When a writing skill and this skill disagree, this skill wins.
Example: a label explained in parentheses, `#12 (tool text wording)`, is allowed even when a writing skill
limits parentheses.

If the owner says he did not understand a reply, rewrite it in plainer words, then put it back into the template.

Before you post, read the reply once as a stranger and check:
- Every label has a link and 3 to 6 words the first time.
- The TL;DR alone tells the owner whether he must act.
- Each step is one action he can do without asking you anything.
- No filler: no "I hope this helps", "great question", "seamless", "leverage", "delve", "it's worth noting".
- No hedging stacks ("it seems that it might"): state the fact, or write "not checked".
- No sentence repeats another one in different words.
- Nothing is announced and then not done ("I will now...").

Then run the lint. It flags bare labels, letter options, "unchanged", "blocked" next to a
non-human, "waiting for you", long lines, emoji, filler phrases, and missing or reordered headings:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/reply-lint.mjs" reply.md              # a templated reply (headings are checked)
node "${CLAUDE_PLUGIN_ROOT}/scripts/reply-lint.mjs" --template reply.md   # force the heading checks
```

Fix every finding, then post.
