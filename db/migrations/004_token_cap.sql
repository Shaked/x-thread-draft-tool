-- Caps existing hand-made xt_ tokens at 7 days from creation (plan D4, Task 7.9).
-- Only moves expires_at earlier, never later. Idempotent: a second run changes nothing.
update api_tokens
   set expires_at = least(
         coalesce(expires_at, created_at + interval '7 days'),
         created_at + interval '7 days'
       )
 where revoked_at is null;
