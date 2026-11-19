# Telegram notices for the labels `try-preview` and `owner` (#243)

- A `try-preview` label on a PR or an `owner` label on an issue or PR sends a Telegram message, only when the repository owner adds the label; other labels and other senders send nothing.
- The workflow `notify-labels.yml` runs from the default branch and never runs code from a PR branch; without the two secrets it skips and stays green.
