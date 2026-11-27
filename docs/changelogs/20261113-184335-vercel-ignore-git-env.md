# A test can no longer commit to the repo

- The Vercel ignore test can no longer write commits into the project's repository.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/96

## Technical details

The vercel-ignore test now strips the hook's GIT_* variables from its child git processes, so it cannot commit into the hooked repo.
