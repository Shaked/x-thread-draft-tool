# Image upload UI test: Vercel automation bypass

- Preview deployments sit behind Vercel Deployment Protection, so the browser was redirected to Vercel login.
- The UI workflow now passes `VERCEL_AUTOMATION_BYPASS_SECRET` to the test as `x-vercel-protection-bypass` on same-origin requests only.
- CI token refusals log the check that failed (ref and event only, no config values).
