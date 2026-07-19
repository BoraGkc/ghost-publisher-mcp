# Contributing

1. Open an issue describing the user-facing problem.
2. Keep changes inside the publishing workflow; broad Ghost Admin API coverage is intentionally out of scope.
3. Run `npm run check` and `npm pack --dry-run`.
4. Never add live credentials or a built-in image-generation provider; generation belongs to the MCP client.

Pull requests should include the smallest test that fails without the change.
