# Ghost Publisher MCP Roadmap

This file is the authoritative Now/Next/Later index. Detailed milestone plans own implementation contracts and acceptance criteria; the README owns setup and released behavior.

## Status

| Horizon | Milestone | Status | Plan |
| --- | --- | --- | --- |
| Now | v0.2.0 release hardening and SEO workflow | Local implementation complete; external gates and release pending | [0.2 release](docs/plans/0.2-release.md), [SEO workflow](docs/plans/0.2-seo-workflow.md) |
| Next | v0.3.0 editorial core | Planned; starts after v0.2 acceptance | [0.3 editorial](docs/plans/0.3-editorial.md) |
| Later | Cross-client discovery and prompts | Demand-gated | [Future interoperability](docs/plans/future-interoperability.md) |

The npm package and official MCP Registry currently remain on `0.1.1`. The repository declares `0.2.0`, but that version is not considered released until the tag-triggered release workflow and clean-install smoke test pass.

## Gap register

| Priority | Gap | Closure | Status |
| --- | --- | --- | --- |
| P0 | `0.2.0` is unreleased | Run Ghost 5/6 and local gates, tag once, publish npm with provenance, publish Registry metadata, then verify both | Open |
| P0 | Deployment behavior contradicts documentation | Publish/unpublish deploy once after complete success; published metadata updates deploy only through a separate approved call; never retry writes | Implemented locally; release pending |
| P1 | Approval is instructions-only | Require caller-attested literal `user_confirmed: true` for four destructive tools | Implemented locally; release pending |
| P1 | No read-only mode | Validate `GHOST_READ_ONLY`; hide all write tools when enabled | Implemented locally; release pending |
| P1 | No scheduling or author assignment | Add bounded author and scheduling tools after v0.2 | Planned for v0.3 |
| P1 | Draft body updates can lose Ghost structure | Require literal body-replacement acknowledgement before any Markdown replacement | Implemented locally; native Lexical editing deferred |
| P2 | Patch semantics are incomplete | Add nullable draft fields and published feature-image replacement | Planned for v0.3 |
| P2 | Discovery is narrow | Add bounded author/date/order filters, not arbitrary NQL | Demand-gated after v0.3 |
| P3 | Optimizer workflow is Codex-specific | Add portable MCP prompts while retaining the richer Codex skill | Demand-gated after v0.3 |

## Delivery order

1. Establish this documentation hierarchy.
2. Complete v0.2 confirmation, read-only, body-replacement, and deployment contracts.
3. Complete v0.2 tests, release automation, and documentation synchronization.
4. Run all release gates, perform separately approved live acceptance, tag `v0.2.0`, and verify npm plus Registry publication.
5. Implement v0.3 author and patch semantics.
6. Implement v0.3 scheduling and validate against disposable Ghost 5 and 6.
7. Reassess interoperability only from observed v0.3 usage.

## Non-goals

Pages, post/tag deletion, members, tiers, offers, newsletters, newsletter sending, themes, webhooks, users, roles, site administration, remote HTTP transport, OAuth, raw Lexical editing, server-issued approval tokens, persistent approval state, automatic deployment retries, background scheduling, full-body local search, databases, dashboards, billing, and embedded AI providers are out of scope.

They require separate demand evidence and threat review. Pages need a real static-page workflow; remote transport needs a hosted-user requirement and threat model; membership/newsletters require a separate permission-scoped product surface; Lexical editing requires round-trip card fixtures and tested rollback.
