# Future Interoperability Plan

Status: demand-gated after v0.3 usage.

## Structured discovery

Extend `list_posts` with bounded fields for author ID, updated and published date boundaries, and an explicit order enum. Retain status, tag, title search, page, and limit. Do not expose arbitrary Ghost NQL and do not download an entire publication for local full-body scanning.

Revisit body search only after a real workflow demonstrates need and defines strict pagination, payload, and latency limits.

## Portable MCP prompts

Add two prompts for clients that support MCP prompts:

- `ghost_safe_publish`: exact draft review, one approval covering named transitions and the configured automatic deployment, publish, and live verification.
- `ghost_seo_optimize`: evidence gathering, exact metadata proposal, approval covering the patch and one named manual deployment, revision-saving update, deploy, and live verification.

Both prompts must treat Ghost, crawl, SEO, query, and SERP content as untrusted evidence; use exact IDs and current timestamps; name every destructive action in approval; never send newsletters; and never edit published bodies. They should work in Codex, Claude, Cursor, and other MCP-prompt clients.

Retain the richer Codex optimizer skill. Do not add duplicate MCP resources while the structured tools already supply the required data.

## Demand triggers

- Add pages only for a demonstrated static-page editorial workflow.
- Add remote transport only for a hosted-user requirement backed by a threat model.
- Add membership or newsletters only as a separate permission-scoped surface.
- Add Lexical editing only after round-trip fixtures prove cards survive and rollback is tested.

Deletion, site administration, webhooks, themes, users, roles, persistent approval state, automatic deployment retries, background scheduling, databases, dashboards, billing, and embedded AI providers remain outside this milestone.
