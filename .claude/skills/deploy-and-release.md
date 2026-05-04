# Skill: Deploy and Release Safety

Use this skill for changes that could affect deployment/runtime behavior.

## Focus areas
- Vercel build/runtime assumptions.
- PWA/service worker side effects.
- Environment variable dependencies.
- Share-link rendering behavior and response expectations.

## Checklist
- Confirm `README.md` / `SETUP.md` still match required env vars.
- Confirm CI still runs unit + E2E in `.github/workflows/tests.yml`.
- Document rollout risk in PR description.
