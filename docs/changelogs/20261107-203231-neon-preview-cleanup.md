# Neon preview-branch cleanup (dry run by default)

- Adds scripts/neon-preview-cleanup.mjs: protects the default branch, the stable preview and open-PR branches; dry-run by default; exact-count confirmation; cap of 10 deletions.
- Adds a weekly dry-run workflow; deletes only from a manual dispatch with an approved neon-cleanup environment.
- Neon API endpoints are not yet verified against Neon docs; verify before the first real run.
