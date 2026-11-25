# Production smoke check starts faster

- The production smoke check starts without installing npm packages first.
- A unit test fails if its scripts ever import a package, so the check stays fast.

Area: Speed
