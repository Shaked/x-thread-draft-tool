# Screenshot harness: isolated seeded owners (review fix on PR #43)

- Each viewport test signs in with its own login (suffix with the width and the run time), so the drafts in `drafts-three.png` are never mixed with the other viewport's or with earlier runs.
