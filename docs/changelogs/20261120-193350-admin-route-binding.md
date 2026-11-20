# Admin tools reach only their own routes
- On the MCP surface, an admin route answers only when its `METHOD /admin/...` key is listed for the caller's admin tool (`adminToolRouteKeys` in `server/mcp/admin-tools.js`); any other route gives the unknown-route 404.
- Tests in `tests/api/admin-guard.test.js` cover a delete route called from `admin_status`, the same route from `admin_delete_user`, and a check that every admin tool maps to a route and every admin route to a tool.
