# Ghost Publisher MCP Roadmap

This file is the authoritative Now/Next/Later index. Detailed milestone plans own implementation contracts and acceptance criteria; the README owns setup and released behavior.

## Status

| Horizon | Milestone | Status | Plan |
| --- | --- | --- | --- |
| Now | v0.2.0 release hardening and SEO workflow | Automated gates complete; live acceptance and release pending | [0.2 release](docs/plans/0.2-release.md), [SEO workflow](docs/plans/0.2-seo-workflow.md) |
| Next | v0.2.1 cross-client onboarding | Implemented and CI-verified; publication follows v0.2.0 | [0.2.1 onboarding](docs/plans/0.2.1-onboarding.md) |
| Planned | v0.3.0 editorial core | Implemented and Ghost 5/6 verified; publication follows onboarding acceptance | [0.3 editorial](docs/plans/0.3-editorial.md) |
| Later | v0.4.0 safe Pages vertical | Implemented and Ghost 5/6 verified; usage review and publication pending | [0.4 Pages](docs/plans/0.4-pages.md) |
| Demand-gated | Portable prompts and broader interoperability | No committed release | [Future interoperability](docs/plans/future-interoperability.md) |

The npm package and official MCP Registry currently remain on `0.1.1`. A user running `npx ghost-publisher-mcp@latest` therefore receives `0.1.1`, not onboarding, scheduling, or Pages. The milestone implementations through `0.4.0` are source-complete on an unmerged branch, but none is user-available until its tag-triggered release and clean-install smoke test pass.

## Gap register

| Priority | Gap | Closure | Status |
| --- | --- | --- | --- |
| P0 | `0.2.0` is unreleased | Run Ghost 5/6 and local gates, tag once, publish npm with provenance, publish Registry metadata, then verify both | Open |
| P0 | Ortak Alan live acceptance cannot run in this task | Connect Ghost Publisher and OpenSEO, prepare one proposal, then obtain exact approval for one patch and one deployment | Blocked on external connections and approval; no live action taken |
| P0 | Roadmap implementation is not merged | Review and merge draft PR [#7](https://github.com/BoraGkc/ghost-publisher-mcp/pull/7) without changing release claims | In review |
| P0 | Deployment behavior contradicts documentation | Publish/unpublish deploy once after complete success; published metadata updates deploy only through a separate approved call; never retry writes | Implemented locally; release pending |
| P1 | Approval is instructions-only | Require caller-attested literal `user_confirmed: true` for four destructive tools | Implemented locally; release pending |
| P1 | No read-only mode | Validate `GHOST_READ_ONLY`; hide all write tools when enabled | Implemented locally; release pending |
| P1 | No scheduling or author assignment | Add bounded author and scheduling tools after v0.2 | Implemented and integration-verified; release pending |
| P1 | Setup is client-specific and manual | Add one interactive local installer for Codex, Cursor, and Claude Desktop | Implemented and cross-platform CI-verified; release pending |
| P1 | Historical v0.2.1 and v0.3 milestone commits predate compatibility fixes | Cut release commits that include the Windows path/transaction fixes for v0.2.1 and legacy Ghost 5 author IDs for v0.3 before tagging | Open; do not tag `a86e82e` or `9c650cd` directly |
| P1 | Current client releases have not been manually smoke-tested | Run the packed installer in current Codex, Cursor, and Claude Desktop before the v0.2.1 tag | Open |
| P1 | Draft body updates can lose Ghost structure | Require literal body-replacement acknowledgement before any Markdown replacement | Implemented locally; native Lexical editing deferred |
| P2 | Patch semantics are incomplete | Add nullable draft fields and published feature-image replacement | Implemented and integration-verified; release pending |
| P2 | Discovery is narrow | Add bounded author/date/order filters, not arbitrary NQL | Implemented and integration-verified; release pending |
| P2 | Pages require Ghost Admin handoff | Add a separate guarded Pages workflow for Ghost-rendered and headless sites | Implemented and integration-verified; usage review and release pending |
| P2 | v0.4 was implemented before observed v0.3 usage | Keep v0.4 unpublished until v0.3 usage confirms the Pages workflow and naming | Open release gate; implementation may remain ready |
| P3 | Optimizer workflow is Codex-specific | Add portable MCP prompts while retaining the richer Codex skill | Demand-gated after v0.3 |

## Delivery order

1. Establish this documentation hierarchy.
2. Complete v0.2 confirmation, read-only, body-replacement, and deployment contracts.
3. Complete v0.2 tests, release automation, and documentation synchronization.
4. Run all release gates, perform separately approved live acceptance, tag `v0.2.0`, and verify npm plus Registry publication.
5. Ship v0.2.1 onboarding without changing the MCP tool surface.
6. Implement v0.3 author, bounded discovery, patch, and scheduling semantics.
7. Validate v0.3 against disposable Ghost 5 and 6, then review observed usage.
8. Implement the v0.4 Pages vertical and validate it against Ghost 5 and 6.
9. Reassess broader interoperability only from observed usage.

## Non-goals

Post/page deletion, tag administration, page scheduling, members, tiers, offers, newsletters, newsletter sending, themes, webhook modification, users, roles, site administration, remote HTTP transport, OAuth, raw Lexical editing, server-issued approval tokens, persistent approval state, automatic deployment retries, background scheduling, arbitrary NQL, full-body local search, databases, dashboards, telemetry, billing, and embedded AI providers are out of scope.

They require separate demand evidence and threat review. Remote transport needs a hosted-user requirement and threat model; membership/newsletters require a separate permission-scoped product surface; Lexical editing requires round-trip card fixtures and tested rollback.

MFYDev/ghost-mcp may be inspected only as a development reference against disposable Ghost. It is not a dependency, fork base, proxy, or production companion. Every adopted behavior must be independently bounded, verified against official Ghost documentation, and covered on Ghost 5 and 6.
