**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Build the search SQL with parameters, not string concatenation**

The handler concatenates `req.query.q` into the SQL text, so a crafted query string can change the statement that runs. Pass the value as a bound parameter instead.

Useful? React with 👍 / 👎.

<!-- codex-code-review-finding:v1 -->
