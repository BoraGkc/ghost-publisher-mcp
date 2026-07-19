# Ghost Publisher MCP

**Write with your AI. Publish safely to Ghost.**

An unofficial, local-first MCP server for creating Ghost drafts, uploading or generating images, publishing approved batches, triggering a static-site rebuild, and checking that posts are live.

Ghost Publisher deliberately exposes 12 editorial tools instead of mirroring the full Ghost Admin API. It has no delete, member, newsletter-send, theme, remote HTTP, or OAuth surface.

> This project is not affiliated with or endorsed by the Ghost Foundation.

## Requirements

- Node.js 22 or newer
- A Ghost custom integration Admin API key
- Optional: an OpenAI API key for `generate_image`
- Optional: a deploy hook and public post URL template for headless/static sites

Create a custom integration in **Ghost Admin → Settings → Integrations**, then copy its Admin API key.

## Codex setup

Add this to `~/.codex/config.toml` or a trusted project's `.codex/config.toml`:

```toml
[mcp_servers.ghost-publisher]
command = "npx"
args = ["-y", "ghost-publisher-mcp"]
env = { GHOST_URL = "https://your-ghost.example.com", GHOST_ADMIN_API_KEY = "your_id:your_secret", GHOST_UPLOAD_ROOTS = "/absolute/path/to/blog-assets", GHOST_DEPLOY_HOOK_URL = "https://your-host.example.com/deploy-hook", GHOST_PUBLIC_POST_URL_TEMPLATE = "https://your-site.example.com/posts/{slug}" }
```

Save the file and restart Codex. The Codex app, CLI, and IDE extension share this MCP configuration.

## Claude Desktop, Cursor, and other MCP clients

Add a stdio server to the client's MCP JSON configuration:

```json
{
  "mcpServers": {
    "ghost-publisher": {
      "command": "npx",
      "args": ["-y", "ghost-publisher-mcp"],
      "env": {
        "GHOST_URL": "https://your-ghost.example.com",
        "GHOST_ADMIN_API_KEY": "your_id:your_secret",
        "GHOST_UPLOAD_ROOTS": "/absolute/path/to/blog-assets"
      }
    }
  }
}
```

Restart the client after changing its MCP configuration.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GHOST_URL` | Yes | — | Ghost instance URL; HTTPS required outside localhost. |
| `GHOST_ADMIN_API_KEY` | Yes | — | Admin key from a Ghost custom integration. |
| `GHOST_API_VERSION` | No | `v5.0` | Ghost Admin API compatibility version. |
| `GHOST_UPLOAD_ROOTS` | For local uploads | — | Allowed absolute directories, separated by the OS path delimiter (`:` on macOS/Linux, `;` on Windows). |
| `OPENAI_API_KEY` | For generation | — | Enables the billable `generate_image` tool. |
| `OPENAI_IMAGE_MODEL` | No | `gpt-image-2` | OpenAI image model override. |
| `GHOST_DEPLOY_HOOK_URL` | No | — | Receives one POST after a fully successful publish/unpublish batch. |
| `GHOST_PUBLIC_POST_URL_TEMPLATE` | No | — | Public URL containing `{slug}`, used by `check_live_posts`. |

The server does not read `.env` files itself. Supply variables through the MCP client or the process environment.

## Tools

| Tool | Behavior |
| --- | --- |
| `check_connection` | Verify Ghost and report optional feature availability without secrets. |
| `list_posts` | List/search posts and obtain exact IDs plus `updated_at`. |
| `get_post` | Read one post by ID or slug with HTML and Lexical content. |
| `list_tags` | List tags with post counts. |
| `create_drafts` | Create up to 10 Markdown posts; always draft-only. |
| `update_draft` | Patch one unchanged draft using optimistic locking. |
| `upload_image` | Upload a validated local image inside configured roots. |
| `generate_image` | Generate one OpenAI image and upload it directly to Ghost. |
| `publish_posts` | Preflight and publish up to 25 exact drafts without sending email. |
| `unpublish_posts` | Preflight and return published posts to draft status. |
| `trigger_deploy` | Retry the configured deploy hook once. |
| `check_live_posts` | Check public HTTP status and expected title text once. |

All successful calls return human-readable text and typed `structuredContent`.

## Example workflow

```text
Research and write three Turkish posts about sustainable city design.
Generate a landscape feature image for each one.
Create all three as Ghost drafts and show me their titles, slugs, and tags.
Do not publish until I approve them.
```

After review:

```text
Publish those exact three drafts, trigger the configured deploy hook,
then check that their public URLs are live.
```

The AI client researches and writes. Ghost Publisher performs the CMS actions and enforces draft-first, version-checked publishing.

## Safety model

- Draft creation cannot publish.
- Updates, publish, and unpublish operations use Ghost's `updated_at` optimistic lock.
- A batch is fully preflighted before its first write. Remote failures can still cause partial completion; exact outcomes are returned and deployment is skipped.
- Local uploads use `realpath`, remain inside `GHOST_UPLOAD_ROOTS`, reject symlink escapes, SVG, unsupported content, and files over 20 MB.
- Callers cannot supply arbitrary upload or deploy URLs.
- API keys, JWTs, hook query strings, and generated bytes are never logged.
- OpenAI generation uses the [Image API](https://developers.openai.com/api/docs/guides/image-generation) and may require organization verification.

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

Run the local build with an MCP client:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/ghost-publisher-mcp/dist/index.js"],
  "env": {
    "GHOST_URL": "https://your-ghost.example.com",
    "GHOST_ADMIN_API_KEY": "your_id:your_secret"
  }
}
```

Tests mock Ghost and OpenAI; CI never spends image-generation credits.

## License

[MIT](LICENSE)
