# Ghost Publisher MCP — Operational Handoff

## Current state

- Repository: `https://github.com/BoraGkc/ghost-publisher-mcp`
- Runtime: Node.js 22+, TypeScript ESM, local stdio MCP
- npm and official MCP Registry release: `0.1.1`
- Repository target: unreleased `0.2.0`
- Normal/read-only tool counts for v0.2: twelve/five

The v0.2 implementation includes caller-attested destructive confirmation, hidden write tools in read-only mode, acknowledged draft body replacement, structured single-attempt deployment failures, and the Ghost/OpenSEO optimizer skill. It is not a release until the acceptance and publication gates pass.

## Authority

- [ROADMAP.md](ROADMAP.md) owns milestone priority and status.
- [v0.2 release plan](docs/plans/0.2-release.md) owns hardening contracts, gates, migration, and rollback.
- [v0.2 SEO workflow](docs/plans/0.2-seo-workflow.md) owns the live metadata acceptance contract.
- [v0.3 editorial plan](docs/plans/0.3-editorial.md) and [future interoperability](docs/plans/future-interoperability.md) are not current implementation scope.
- `README.md` owns setup and user-facing behavior; `CHANGELOG.md` distinguishes unreleased from released changes.

## Remaining v0.2 operations

1. Local check, high-severity audit, and package dry-run passed on 2026-07-20; rerun them on the final release commit.
2. Require branch CI on Node 22 and 24.
3. Run disposable Ghost 5 and Ghost 6 integration for the release commit.
4. Complete an Ortak Alan proposal-only SEO run without a write.
5. Obtain separate exact approval for one low-risk metadata patch and one deployment; verify revision, unchanged body, one hook request, and rendered metadata.
6. Tag `v0.2.0` once. The release workflow must publish npm with provenance, publish Registry metadata with GitHub OIDC, and verify both versions.
7. Install the published package in a clean MCP client and repeat connection plus draft smoke tests.

No npm token, separate Registry workflow, or manual Registry overwrite belongs in this process. Do not mutate the live Ghost site during routine verification, and never commit credentials.

## Product boundary

This is a safe editorial workflow, not a Ghost Admin API mirror. Do not add pages, deletion, newsletters, members, themes, arbitrary API execution, OAuth, remote HTTP transport, persistent approvals, deployment retries, or raw Lexical editing without the demand and threat reviews named in the roadmap.
