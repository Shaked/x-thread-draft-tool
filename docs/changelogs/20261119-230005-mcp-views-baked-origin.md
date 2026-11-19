# MCP views: the image origin is baked into the thread and drafts views (#238)

- Views show images even when a host drops the tool's _meta: the environment's Blob origin is written into the HTML (only a valid Blob origin, else null).
- The manifest publishes the origin, and the production smoke check rebuilds the views from it, so a changed view still fails the check.
