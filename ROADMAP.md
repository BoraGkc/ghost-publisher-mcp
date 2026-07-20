# Ghost Publisher MCP Roadmap

This file is the authoritative Now/Next/Later index. Detailed milestone plans own implementation contracts and acceptance criteria; the README owns setup and released behavior.

## Status

| Horizon | Milestone | Status | Plan |
| --- | --- | --- | --- |
| Current | v0.4.1 release correction | Corrected npm documentation and published-package MCP smoke coverage | [0.4 Pages](docs/plans/0.4-pages.md) |
| Shipped | v0.2.0 release hardening and SEO workflow | Included in the consolidated v0.4.0 release | [0.2 release](docs/plans/0.2-release.md), [SEO workflow](docs/plans/0.2-seo-workflow.md) |
| Shipped | v0.2.1 cross-client onboarding | Included in the consolidated v0.4.0 release | [0.2.1 onboarding](docs/plans/0.2.1-onboarding.md) |
| Shipped | v0.3.0 editorial core | Included in the consolidated v0.4.0 release | [0.3 editorial](docs/plans/0.3-editorial.md) |
| Shipped | v0.4.0 safe Pages vertical | Published and verified on 2026-07-21 | [0.4 Pages](docs/plans/0.4-pages.md) |
| Demand-gated | Portable prompts and broader interoperability | No committed release | [Future interoperability](docs/plans/future-interoperability.md) |

The npm package and official MCP Registry serve `0.4.1`. The tag workflow passes Ghost 5/6 integration, package checks, audit, npm provenance publication, Registry publication, and public version verification. The published package also passes initialization, normal/read-only tool discovery, connection checks, and disposable draft creation through a real MCP client.

## Gap register

| Priority | Gap | Closure | Status |
| --- | --- | --- | --- |
| P0 | The immutable v0.4.0 npm README retained prerelease wording | Publish corrected documentation as the next patch rather than overwriting v0.4.0 | Closed in v0.4.1 |
| P0 | `0.2.0` was not published separately | Ship the completed milestone contracts together in the next immutable release | Closed in v0.4.0 |
| P0 | Roadmap and implementation branches were unmerged | Merge PR [#8](https://github.com/BoraGkc/ghost-publisher-mcp/pull/8) and PR [#7](https://github.com/BoraGkc/ghost-publisher-mcp/pull/7) | Closed in v0.4.0 |
| P0 | Deployment behavior contradicted documentation | Publish/unpublish deploy once after complete success; published metadata updates deploy only through a separate approved call; never retry writes | Released in v0.4.0 |
| P1 | Approval was instructions-only | Require caller-attested literal confirmation at the schema boundary | Released in v0.4.0 |
| P1 | No read-only mode | Validate `GHOST_READ_ONLY`; hide all write tools when enabled | Released in v0.4.0 |
| P1 | No scheduling or author assignment | Add bounded author and scheduling tools | Released in v0.4.0 |
| P1 | Setup was client-specific and manual | Add one interactive local installer for Codex, Cursor, and Claude Desktop | Released in v0.4.0 |
| P1 | Current client releases need ongoing smoke coverage | Last manual smoke: Codex CLI `0.145.0-alpha.18`, Cursor `3.12.17`, and Claude Desktop `1.22209.3` on 2026-07-21; repeat after client updates | Monitor |
| P1 | Draft body updates can lose Ghost structure | Require literal body-replacement acknowledgement before any Markdown replacement | Released; native Lexical editing deferred |
| P2 | Patch semantics were incomplete | Add nullable draft fields and published feature-image replacement | Released in v0.4.0 |
| P2 | Discovery was narrow | Add bounded author/date/order filters, not arbitrary NQL | Released in v0.4.0 |
| P2 | Pages required Ghost Admin handoff | Add a separate guarded Pages workflow for Ghost-rendered and headless sites | Released in v0.4.0; monitor usage |
| P3 | Optimizer workflow is Codex-specific | Add portable MCP prompts while retaining the richer Codex skill | Demand-gated after observed v0.4 usage |

## Delivery order

1. v0.4.0 consolidated release and v0.4.1 documentation correction: complete.
2. Monitor setup, scheduling, and Pages usage across supported clients.
3. Correct release defects with the next patch version; never overwrite published versions.
4. Reassess broader interoperability only from observed usage.

## Non-goals

Post/page deletion, tag administration, page scheduling, members, tiers, offers, newsletters, newsletter sending, themes, webhook modification, users, roles, site administration, remote HTTP transport, OAuth, raw Lexical editing, server-issued approval tokens, persistent approval state, automatic deployment retries, background scheduling, arbitrary NQL, full-body local search, databases, dashboards, telemetry, billing, and embedded AI providers are out of scope.

They require separate demand evidence and threat review. Remote transport needs a hosted-user requirement and threat model; membership/newsletters require a separate permission-scoped product surface; Lexical editing requires round-trip card fixtures and tested rollback.

MFYDev/ghost-mcp may be inspected only as a development reference against disposable Ghost. It is not a dependency, fork base, proxy, or production companion. Every adopted behavior must be independently bounded, verified against official Ghost documentation, and covered on Ghost 5 and 6.
