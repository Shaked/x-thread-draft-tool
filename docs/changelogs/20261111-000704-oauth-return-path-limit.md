# The sign-in request size limit is documented

- The API guide now says a sign-in request that must survive GitHub sign-in can be at most 2,000 characters.
- Longer requests cannot be kept through GitHub sign-in.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/71

## Technical details

Docs: the 2,000-character limit on an authorize request that survives GitHub sign-in is now documented in docs/agents/api.md (bug B2; the cookie route cannot hold the requests that exceed it).
