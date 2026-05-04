# Skill: High-Risk Feature Concentration

Use this skill when modifying sensitive features.

## High-risk zones
- One-time X-thread preview token flow.
- Draft sync/conflict behavior.
- Publish/archive transitions.
- Image upload and cleanup paths.

## Guidance
- Prefer small, isolated commits.
- Add regression-oriented tests when touching these paths.
- Call out fallback behavior and error UX explicitly.
