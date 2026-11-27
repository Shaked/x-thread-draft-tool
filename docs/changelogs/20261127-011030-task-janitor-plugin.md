# Task janitor moves into a plugin

- The task janitor, its session matcher and the status board are now a plugin, installable by other projects.
- Each project sets its own owner, report issue and reply lint in its settings file; this repository behaves as before.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/569

## Technical details

plugins/task-janitor (0.1.0). Scripts in scripts/ are wrappers; the skill and the two commands are linked from .claude/. The plugin CLI check counts commands as skills.
