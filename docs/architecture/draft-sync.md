# How draft saves, conflicts and live updates work

This page is the short version. The rules are in `server/routes/drafts.js` and `server/mcp/tools.js`.
Checked against `main` on 2026-11-25 (after #360, #361 and #363 merged).

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
- On `412` it stops saving and shows a banner: "This draft changed in another app while you were editing."
  - **Show their changes**: keeps your text in a read-only box with a Copy button, then shows the saved draft.
  - **Keep mine**: saves your text as a new version on top of theirs.
- End-to-end check with two writers (an API call as the AI app, the browser as the user, the same post): `tests/e2e/draft-conflict-banner.spec.ts` (#474). The banner shows, the AI text stays stored, and the user's text is in the copy box.
- Not built yet: automatic merge when the two sides changed different posts. Every `412` shows the banner.

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
- Database and compute cost per check: not measured. Neon suspend delay: not checked.
- Vercel invocation limit and transfer share: not checked.
- REST rate limit on this route: none in `server/router.js` (not re-checked here).

## Related

- Rule table: [capabilities.md](capabilities.md), rows "Did the draft change?" and "Edit draft settings".
- API details: [api.md](../agents/api.md), section "Concurrent edits".
