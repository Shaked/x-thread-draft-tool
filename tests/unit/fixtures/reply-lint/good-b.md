## TL;DR
Two questions on the [#273 one product epic](https://github.com/Shaked/x-thread-draft-tool/issues/273) have no answer from you yet:
the unit test time limit, and the margin rule for the tool text test. Each has a default.
You need to do 2 things (below).

## What you need to do
1. Answer the time limit question on [the unit time limit comment](https://github.com/Shaked/x-thread-draft-tool/issues/273#issuecomment-7058464167):
   reply `move slow tests`, `raise to 75` or `do nothing`.
2. Answer the margin question on [the margin question comment](https://github.com/Shaked/x-thread-draft-tool/issues/273#issuecomment-7054238173):
   reply `report only`, `re-record once` or `keep as is`.

## Waiting for
Nothing.

## Blocked on you
### Time limit of the unit test check
- **What is decided:** whether you keep seeing random red unit-test checks on PRs. The unit-test job in CI has a
  70-second limit, and the tests take 72 to 74 seconds there (from the question, not checked against CI runs).
  Two design PRs each failed once on it and passed on re-run.
- **Options:**
  1. **Move slow tests** (reply `move slow tests`): the three slowest API test files (`oauth-migration`, `migrate`,
     `suspension`) move to the `tests/api` job. They still run on every PR, outside the 70-second limit. Nothing is skipped.
  2. **Raise to 75 s** (reply `raise to 75`): simple, but it only moves the edge, and the tests keep growing.
  3. **Do nothing** (reply `do nothing`): expect random red unit-test checks and re-runs.
- **Recommendation:** move slow tests. Every test still runs, and the limit stays as it is.
- **If nobody answers:** do nothing, because the limit is a repo rule only you change. If the
  [#306 CI speed plan](https://github.com/Shaked/x-thread-draft-tool/issues/306) finds a real speed-up first, that comes first.
- **Where to answer:** [the unit time limit comment](https://github.com/Shaked/x-thread-draft-tool/issues/273#issuecomment-7058464167), with the words above.

### Margin rule for the tool text test
- **What is decided:** whether [#279 tool text wording](https://github.com/Shaked/x-thread-draft-tool/issues/279) can ship text
  that makes Claude, ChatGPT and Grok pick our tools more often. A test rule stops it today: no "margin" may go down.
  A margin is how far the right tool scores above the next best one.
- **Options:**
  1. **Report only** (reply `report only`): margins show in the test output but no longer fail it. The top-1, top-3,
     admin-leak and known-failure checks stay. Each PR lists the margins that fell, and a review agent checks the list.
  2. **Re-record once** (reply `re-record once`): margins still fail the test. The #279 PR records new margins once,
     with your approval. Every later text change needs your approval again.
  3. **Keep as is** (reply `keep as is`): nothing changes. #279 cannot change the tool text, and the 3 admin leaks
     and 27 misses per mode stay (numbers from the question, not checked again).
- **Recommendation:** report only (a review agent, 2026-11-21). Margins are raw search scores that change scale whenever any
  tool text changes, so two versions cannot be compared.
- **If nobody answers:** keep as is. #279 and [#280 slash command prompts](https://github.com/Shaked/x-thread-draft-tool/issues/280) wait.
- **Where to answer:** [the margin question comment](https://github.com/Shaked/x-thread-draft-tool/issues/273#issuecomment-7054238173), with the words above.

## Done
- Read every comment on #273 on 2026-11-21: neither question has an answer, checked.
