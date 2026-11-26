# Faster checks on every pull request

- The unit tests now run in three parallel parts, so no part goes over its time limit.
- A test run that is too slow now names the slowest files in its error message.
