# Tool text changes now move only that tool's discovery score

- The offline test that scores how well assistants find each tool now keeps its word statistics fixed.
- No change for people using the app.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/618

## Technical details

Corpus statistics (N, avgdl, df) are stored in `tests/eval/discovery/stats.json`. `--record` leaves them alone; `--refresh-stats` rewrites them and every floor. A token not in the file gets df=1. Implements #273 Task 5 (scorer).
