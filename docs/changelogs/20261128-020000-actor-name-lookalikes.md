# Fake app names can no longer pose as the editor in draft history
- An app whose name imitates a fixed writer name (Editor, Import, API token) now shows as App in the history.
Area: Drafts
Link: https://github.com/Shaked/x-thread-draft-tool/pull/627
Screenshot: not needed, history text only

## Technical details
Folding in `server/revision-actor.js`: small capitals, IPA, Cherokee, Lisu, Greek N, palochka, and l for i, 0 for o. Implements #376 Task H3.
