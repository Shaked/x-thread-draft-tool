# Telegram message after each production smoke run

- The deployed smoke workflow now sends a Telegram message for production only: "live and tested" on success, "PRODUCTION SMOKE FAILED" with the run link on failure. Without the two secrets it skips silently (epic #241, task N1).
