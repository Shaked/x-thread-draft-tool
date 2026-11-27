# Sign-in refresh checks the resource

- A refresh request for a different resource is refused with an invalid target error.
- The refusal does not use up the refresh token.
- A refresh request with no resource still works.

Area: Security
Link: https://github.com/Shaked/x-thread-draft-tool/pull/98

## Technical details

# OAuth: refresh checks resource (D-2)
- POST /api/oauth/token with grant_type=refresh_token refuses a resource other than the grant's with invalid_target (400). The token is not spent by that refusal. Absent resource still works.
