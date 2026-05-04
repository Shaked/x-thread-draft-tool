# CI/CD Notes

## Local
- Pre-commit hook runs `npm run precommit:checks`.
- `precommit:checks` runs lint + unit tests.

## GitHub Actions
- Unit and E2E jobs run in `.github/workflows/tests.yml`.
- E2E is expected to run in Actions as the default gate.
