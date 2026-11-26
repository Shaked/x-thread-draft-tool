# Sync and Offline

- Neon-backed draft persistence through `/api/drafts`.
- Offline editing support with local persistence.
- Conflict resolution based on latest update timestamp.
- Cheap change check: a read of a draft with the version the client holds as `If-None-Match` answers 304 with no body while the draft is unchanged (#360). The owner only.
- Another app changed the draft while the editor had edits (a save gets 412): autosave pauses, and a banner offers "Show their changes" (adopt the other app's draft; my text stays in a box to copy, and is kept in this browser until I copy it or keep mine, so it shows again when I open the draft) or "Keep mine" (save my text as a new version on top). When the other app changed other posts (not the same post, at most one side changed the title, at most one side added, removed or moved posts, no image upload in flight), the editor merges both changes, saves once, and shows "Changes from another app were added. Your edits are kept." for 6 s instead (#474). If the merged save fails for another reason it is not retried until the next edit; my text is kept in this browser until a save works.
- The editor saves only after an edit. A draft the user did not touch makes no save, including on page unload.
- Signed out (a save gets 401, for example after sign-out in another tab): the editor says "Not saved" with a note to copy the text and sign in again. The text stays in the editor and is not cached.
