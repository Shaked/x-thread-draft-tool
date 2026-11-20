# MCP tool discovery score

Question it answers: when a user writes a phrase, which tool would an AI app pick from our tool names, titles and descriptions? It runs offline, is deterministic and costs nothing. Code: `tests/eval/discovery/score.mjs`. Corpus: `intents.json` (13 intents, English and Hebrew). Floors: `baseline.json`. Client facts: `clients.json`. Test: `tests/api/mcp-discovery.test.js`, run by `npm test`.

## Reading the table

Run `node tests/eval/discovery/score.mjs` to print the table. Each row is one intent, language and mode:

- `top1`: phrases whose expected tool ranked first, out of the phrases in that row.
- `top3`: phrases whose expected tool ranked in the first three.
- `margin`: for each phrase, the best expected tool's score minus the best other tool's score. The row shows the lowest margin. A negative margin means another tool wins.
- `negatives`: the highest score any write tool gets for a question that needs no write. Lower is better.

The scoring is BM25 (k1 1.2, b 0.75) over one document per tool: the name split on `_`, the title and the description. Hebrew text is normalised (Hebrew vowel points removed; a Hebrew token of 3 or more letters that starts with a prefix letter ו ה ב ל מ ש כ is also indexed without that letter). In the `with_instructions` mode, the sentences of the server instructions that name a tool are added to that tool's document. The `tools_only` mode is the safe case for clients that do not read instructions. Both modes run for every client, and the admin pool (normal and admin tools together) runs in both modes too.

## Rules for the baseline

- The test fails when a row's `top1`, `top3` or `margin` falls below its floor, when a negative's write score is above its threshold, when a positive phrase misses the top 3 and is not in `known_failures`, or when an admin tool ranks first for a normal phrase without a `known_failures` entry.
- Later PRs may only **raise** floors and **remove** known failures. The test reads only the current file. The Opus reviewer checks in the PR diff that no floor went down and that no known failure was added to hide a regression.
- To raise a floor after a fix, run `node tests/eval/discovery/score.mjs --record` and commit the new `baseline.json`. `--record` refuses to lower any floor or raise a threshold unless `--allow-lower` is also passed; say in the PR why it was needed. Check the diff: every number must be the same or higher, and removed known failures must be phrases that now pass.
- Adding phrases is allowed. A new phrase that misses the top 3 must either be fixed or added to `known_failures` with a reason. Do not change expected tools to make a phrase pass.
- Known failures carry `kind`: `top3` (missed the top 3) or `admin_first` (an admin tool ranks first for a normal phrase in the admin pool).

## Clients

`clients.json` lists what each AI app shows (server instructions, prompts, resources, UI views, tool title). Every value is `true`, `false` or `"not checked"`, with a source URL that was read. A value stays `"not checked"` until a page we read states it. `clients.json` is a record only: no score reads it, and the test checks its shape. Negative thresholds are ceilings: a negative passes when its best write-tool score is at or below the threshold.
