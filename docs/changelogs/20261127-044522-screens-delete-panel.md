# The screenshot check no longer hangs on the delete step

The screenshot harness waited for a dialog that the new delete button never opens.
It now waits for the panel the button does open, and finishes in about 40 seconds.
Area: Design
Link: https://github.com/Shaked/x-thread-draft-tool/pull/590
