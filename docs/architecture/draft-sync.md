# How draft saves, conflicts and live updates work

This page is the short version. The rules are in `server/routes/drafts.js` and `server/mcp/tools.js`.
Checked against `main` on 2026-11-26 (after #360, #361, #363, #474 merged).

## The revision

- Every draft has a `version` number (`drafts.version`, added by `db/migrations/005_draft_version.sql`).
- Every write runs in one transaction on a locked row and adds 1 to `version`.
- `GET /api/drafts/:id` and every write answer carry `ETag: "<version>"`.

## Saves with If-Match

- A write can send `If-Match: "<version>"`: the version the writer last read.
- If the draft changed since, the answer is `412` with `{ error, version, draft }` and the current `ETag`.
  Nothing is written, and the current draft is in the answer, so no extra read is needed.
- `If-Match: *` matches any version. No header means no check.
- A weak tag (`W/"3"`) never matches a write: `412`. Any other malformed value is `400`.
- A repeat of a change that is already saved (same text, same title) is `200` with no write and no version change.

## Who sends If-Match

| Writer | Version parameter |
|---|---|
| Editor (`src/utils/api.js`, `draftsApi.update`) | Sends the version it loaded or last saved, on every save. |
| MCP `update_draft` | Optional `version`. |
| MCP `update_post` | Optional `version`. |
| MCP `move_post` | Optional `version`. |
| MCP `remove_image` | Optional `version`. |
| MCP `add_image_from_url` | `version` only with `replace`. |
| MCP `add_post`, `remove_post` | No parameter. The handler reads the draft, then writes with that version. A change between the two steps gives `412`. |

A `412` from MCP says: nothing was written. It asks the caller to call `get_draft_outline` once (`get_draft` if the text is needed), then repeat the change.
The `version` argument of every MCP tool has `minimum: 1` and `maximum: 2147483647` (the largest Postgres `integer`). A larger number is a tool argument error (`Invalid argument version: must be at most 2147483647`), not a `412` and not a database error (#474).
The tools do not retry for the caller, with one exception: `add_image_from_url` with `post_id` re-reads and retries a `412` itself, up to 4 × posts + 1 tries in all. The image url is unique to the call and a `412` writes nothing, so a retry cannot add the image twice.

## The editor

- The editor loads the draft once, then keeps the version from each read and each save.
- It saves only after a real edit. An untouched draft makes no save, including on page unload (#361).
- On `412` the editor compares per post id: the copy it last read or saved (base), my copy, and the draft in the `412` answer (theirs).
  `src/utils/draftMerge.js` decides. It merges, and saves once with `If-Match` of their version, only when all of these hold:
  - the two sides changed different posts (a removal counts as a change of that post; the same change on the same post still counts);
  - at most one side changed the title;
  - at most one side added, removed or moved posts (that side's order is used);
  - no image upload is in flight (its result is written from the draft it started with and would undo the merge).
  After a merge it shows for 6 s: "Changes from another app were added. Your edits are kept." The posts that came from the other app are highlighted.
  The user's text is also kept in this browser until the merged save works, so closing the page during the merge loses nothing.
- Any other `412` stops saving and shows the banner: "This draft changed in another app while you were editing."
  - **Show their changes**: keeps your text in a read-only box with a Copy button, then shows the saved draft.
  - **Keep mine**: saves your text as a new version on top of theirs.
- If the merged save itself gets `412`, the banner shows (no second merge, so a busy AI app can not loop the editor). Nothing is lost: the text is in the editor and kept in this browser.
- A save that was queued before a merge never runs after it, because it holds text from before the merge.
- End-to-end checks with two writers (an API call as the AI app, the browser as the user): `tests/e2e/draft-conflict-banner.spec.ts` (#474). Same post: the banner shows, the AI text stays stored, the user's text is in the copy box. Different posts: both texts are stored, with the note and no banner.

## Live updates (the 304 check)

- While the editor page is visible and nothing is unsaved or saving, it sends
  `GET /api/drafts/:id` with `If-None-Match: "<version>"` (#360, #363).
- Unchanged: `304`, no body. Changed: `200` with the draft and a new `ETag`.
- Another user's draft gets `404`, never `304`.
- Rate: every 4 s. After 2 min with no change and no input: every 15 s.
  After 10 min: paused until Resume, input or a visibility change.
- A hidden page is not checked. Checks resume at once when the page is visible again.
- Each check runs two statements: the session check and one draft statement (checked by `tests/api/draft-poll.test.js`).
  The 304 has no body (checked by the same test).
- MCP `get_draft` does not use the check. Nothing else sends `If-None-Match` today.

## Cost per open editor tab

- Active tab, 4 s rate: about 900 checks per hour.
- Idle tab: about 62 checks from the start of an idle stretch to the pause, then none until input.
- Worst case, visible and active 3 hours a day: about 2,700 checks a day, about 81,000 a month.
- Measured on 2026-11-26 (#474), locally with `npm run dev:api` (real route and SQL on PGlite, one 2-post draft, raw response read with `curl -D`):
  - **Bytes per 304:** 233 bytes of response headers, 0 bytes of body (checked). The same draft as a 200: 283 bytes of headers and 380 bytes of body (checked). Request bytes (the cookie or token header) and the extra headers Vercel adds: not checked.
  - **Statements per check:** 2, the session check and one draft statement (checked, `[perf]` line `q:2`, same as `tests/api/draft-poll.test.js`).
  - **Time per check on PGlite:** `ms` 1.3 to 1.5, `db` 1.2 to 1.3 (checked, local). This is not Neon's latency. A [perf] line for a 304 on the preview deployment: not checked (the preview has no smoke-test user, and a 304 needs a signed-in request).
  - **Monthly transfer, one tab visible and active 3 h a day:** 81,000 checks (the idle tail of about 62 checks a day adds about 1,900 more, 82,900 in all; the numbers below use 81,000) x 233 bytes = about 19 MB of response headers (computed from the measured bytes). The Hobby plan includes 100 GB of Fast Data Transfer a month, so this is about 0.02 percent. Deployed bytes: not checked.
  - **The "5 GB" in #474:** it is not on the Hobby plan page, which lists 100 GB of Fast Data Transfer. The Neon Free plan has 5 GB of public network transfer per project a month ([Neon plans](https://neon.com/docs/introduction/plans)), which may be what was meant. That limit counts data sent from the database over the public internet, so the Neon side is the rows each check reads (the session row and the draft row) going to the Vercel function.
  - **Neon egress per check:** not checked. PGlite does not report wire bytes, and a measurement on a Neon branch needs a signed-in request to a deployment. Unmeasured, so no share of the 5 GB is given.
- Vercel Hobby limits, read on 2026-11-26 from [the Hobby plan page](https://vercel.com/docs/plans/hobby) (last updated 2026-11-12): first 1,000,000 Function Invocations and first 100 GB Fast Data Transfer a month. Over the limit, the page says you wait until 30 days have passed before you can use the feature again. 81,000 checks are 8.1 percent of the invocations for one such tab, and every extra open tab adds the same. A per-second or per-minute invocation rate limit on Hobby: not checked (the limits page was only partly read). That the project is on Hobby: not checked.
- Neon, read on 2026-11-26 with read-only tools (project `neon-gray-drum`): both compute endpoints have `autoscaling_limit_min_cu` and `max_cu` of 0.25 and `suspend_timeout_seconds` 0. The Neon docs say a compute suspends after 5 minutes without queries ([Scale to Zero](https://neon.com/docs/introduction/scale-to-zero)). Whether 0 means that default in the API: not checked. The Neon plan of the organization: not checked.
- **Neon suspend delay and the live check:** the check runs every 4 s, far below 5 minutes, so an open active tab keeps the compute awake (derived from the two numbers above). After the 10 minute pause (see above) no check runs and the compute can suspend 5 minutes later.
- **CU-hours, one tab visible and active 3 h a day for 30 days, as one stretch a day:** after the last input the tab keeps checking for 10 minutes before it pauses, and the compute suspends 5 minutes after that, so each stretch adds a tail of about 15 minutes. 0.25 CU x (3 h + 15 min) x 30 = about 24.4 CU-hours a month (computed). Each extra separate stretch a day adds one more tail (about 0.06 CU-hours a day, about 1.9 a month). Time when other traffic keeps the compute awake anyway costs nothing extra. The Free plan includes 100 CU-hours per project a month ([Neon plans](https://neon.com/docs/introduction/plans)), so this would be about 24 percent of that allowance (the plan itself: not checked). The project's own `active_time` was 232,068 s (about 64.5 h) from 2026-11-07 to 2026-11-26 14:33 UTC, so the compute is already awake about 3.4 h a day on average (checked, read-only).
- REST rate limit on this route: none in `server/router.js` (not re-checked here).

## Related

- Rule table: [capabilities.md](capabilities.md), rows "Did the draft change?" and "Edit draft settings".
- API details: [api.md](../agents/api.md), section "Concurrent edits".
