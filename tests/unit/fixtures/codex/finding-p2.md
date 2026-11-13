**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Align preview smoke guidance with the actual workflow**

For preview deployments, this describes a skip rule that does not exist in the reviewed code. `.github/workflows/smoke-deployed.yml:67–73` selects `XT_SMOKE_TOKEN` for non-production URLs and runs the same smoke script; `scripts/smoke.mjs` unconditionally attempts the account checks and has no `SKIP` behavior. Consequently, agents following this skill will misdiagnose preview 401s as a lost workflow rule rather than investigate the token/database mismatch. Either implement the documented public-only preview behavior or update this guidance to reflect the current workflow.

Useful? React with 👍 / 👎.

<!-- codex-code-review-finding:v1 -->
