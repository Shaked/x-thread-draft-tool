# Sync and Offline

- Neon-backed draft persistence through `/api/drafts`.
- Offline editing support with local persistence.
- Conflict resolution based on latest update timestamp.
- Cheap change check: a read of a draft with the version the client holds as `If-None-Match` answers 304 with no body while the draft is unchanged (#360). The owner only.
- Signed out (a save gets 401, for example after sign-out in another tab): the editor says "Not saved" with a note to copy the text and sign in again. The text stays in the editor and is not cached.
