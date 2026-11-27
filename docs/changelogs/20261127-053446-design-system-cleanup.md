# Design system cleanup (#329)

`src/styles/App.css` is gone: the few rules still in use moved to `src/App.css` and use tokens only. The old variable aliases, the `--legacy-*` sizes and the dead classes are deleted, `LEGACY` is removed from the token lint (it now applies to every file), and a test fails on any old variable name. Nothing changes on screen.
