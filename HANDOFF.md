# Ghost Publisher MCP — Agent Handoff

## Repository

- GitHub: https://github.com/BoraGkc/ghost-publisher-mcp
- Local checkout: `/Users/boragokce/Documents/Codex/2026-07-02/https-ortakalan-io/ghost-publisher-mcp`
- Branch: `main`
- Runtime: Node.js 22+, TypeScript, ESM, local stdio MCP
- Package target: `ghost-publisher-mcp@0.2.0`

This is intentionally separate from the private Ortak Alan Astro repository.

## Product boundary

Ghost Publisher is a safe editorial workflow, not a complete Ghost Admin API mirror. It exposes 12 tools:

`check_connection`, `list_posts`, `get_post`, `list_tags`, `create_drafts`, `update_draft`, `update_published_post`, `upload_image`, `publish_posts`, `unpublish_posts`, `trigger_deploy`, and `check_live_posts`.

Draft creation cannot publish. Updates and status changes require the current `updated_at`. Published updates are metadata-only, save a Ghost revision, and preserve status. Publish/unpublish batches are preflighted before the first write, and deployment runs only after a completely successful batch.

## Image decision

Do not add `OPENAI_API_KEY`, an image SDK, or a `generate_image` MCP tool. Codex, Claude, or another host AI generates images with its existing capability, saves them inside `GHOST_UPLOAD_ROOTS`, calls `upload_image`, and attaches the returned Ghost URL to the draft.

An MCP subprocess cannot directly invoke a separate tool owned by its host, so the host agent orchestrates the generation and upload steps.

## Current state

- Core server, typed schemas, Markdown-to-HTML conversion, Ghost operations, local image upload, deploy hook, and live checks are implemented.
- README, MIT license, security policy, contributing guide, and changelog exist.
- Public GitHub repository is created and `main` tracks `origin/main`.
- CI, Ghost 5/6 integration, and npm release workflows are implemented.
- `npm run check` passes: typecheck, lint, 18 unit tests, and build.
- `npm audit --audit-level=high` reports zero vulnerabilities.
- `npm pack --dry-run` succeeds.
- Node.js 22/24 CI and disposable Ghost 5/6 release-gate workflows are configured. The integration flow includes a published-post metadata update; run it before any live-site acceptance because Docker is unavailable in the current local environment.
- `ghost-publisher-mcp@0.1.1` is published on npm with provenance; npm trusted publishing is configured for `release.yml`, and the bootstrap GitHub secret is deleted.
- `io.github.BoraGkc/ghost-publisher@0.1.1` is published in the official MCP Registry.
- The Ghost + hosted OpenSEO hybrid workflow and versioned optimizer skill are prepared for Ortak Alan acceptance testing.

Recent commits:

- `0a45fa1 feat: add Ghost Publisher MCP`
- `4a1c86f fix: use client image generation`

## Configuration

Required:

```text
GHOST_URL
GHOST_ADMIN_API_KEY
```

Optional:

```text
GHOST_API_VERSION=v5.0
GHOST_UPLOAD_ROOTS
GHOST_DEPLOY_HOOK_URL
GHOST_PUBLIC_POST_URL_TEMPLATE
```

Never commit credentials. The Ghost Admin key previously shared in chat should be rotated before public demos, screenshots, or release work.

## Next work

1. Run the disposable Ghost 5 and Ghost 6 integration workflow and require both jobs to pass.
2. Run the Ortak Alan workflow in proposal-only mode, using free/cached evidence before any approved paid OpenSEO calls.
3. Approve one low-risk metadata-only patch, confirm its Ghost revision exists, deploy once, and verify rendered metadata on the public URL.
4. Commit, push, tag, and publish `0.2.0` with npm provenance only after those gates pass.
5. Revoke the two short-lived bootstrap npm tokens and submit the repository to MCP Market's free queue.
6. Configure the published package in Codex and run the draft acceptance flow: upload images, create three drafts, approve, publish, deploy, and verify live URLs.

Do not add pages, newsletters, members, themes, arbitrary API execution, remote image URLs, OAuth, remote HTTP transport, or Docker runtime support unless real demand justifies the added security surface.

## Commands

```bash
npm install
npm run check
npm audit --audit-level=high
npm pack --dry-run
```

Use mocked tests by default; do not mutate the live Ghost site during routine verification.
