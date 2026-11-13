# OAuth: refresh checks resource (D-2)
- POST /api/oauth/token with grant_type=refresh_token refuses a resource other than the grant's with invalid_target (400). The token is not spent by that refusal. Absent resource still works.
