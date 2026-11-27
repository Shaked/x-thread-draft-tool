Test tooling: the offline discovery scorer now reads frozen corpus statistics (N, avgdl, df) from `tests/eval/discovery/stats.json`, so changing one tool's text moves only that tool's scores. `--refresh-stats` re-records stats and every floor. No tool text and no floor changed.
Screenshot: not needed, test tooling only.
