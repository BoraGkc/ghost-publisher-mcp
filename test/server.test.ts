import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { GhostPublisher } from '../src/publisher.js';
import { createServer } from '../src/server.js';

const id = 'a'.repeat(24);
const updatedAt = '2026-01-01T00:00:00.000Z';
const config: Config = {
  ghostUrl: 'https://ghost.example.com',
  ghostAdminApiKey: `${'a'.repeat(24)}:${'b'.repeat(64)}`,
  ghostApiVersion: 'v5.0',
  readOnly: false,
  uploadRoots: [],
};

function post(status: 'draft' | 'published' = 'published') {
  return {
    id,
    title: 'Published post',
    slug: 'published-post',
    status,
    updated_at: updatedAt,
    tags: [],
    html: '<p>Body</p>',
    lexical: '{"root":{"type":"root","children":[]}}',
  };
}

async function connect(publisher: GhostPublisher) {
  const server = createServer(publisher);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe('MCP contract', () => {
  it('advertises twelve normal tools, requires literal destructive confirmation, and redacts errors', async () => {
    const edit = vi.fn(async () => {
      throw new Error(`Ghost rejected ${config.ghostAdminApiKey}`);
    });
    const publisher = new GhostPublisher(config, {
      ghost: {
        site: { read: async () => ({ title: 'Test Ghost', url: 'https://ghost.example.com' }) },
        posts: { read: async () => post(), edit },
      },
    });
    const { client, server } = await connect(publisher);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toHaveLength(12);
    expect(tools.tools.map((tool) => tool.name)).not.toContain('generate_image');
    expect(tools.tools.map((tool) => tool.name)).toContain('publish_posts');
    expect(tools.tools.find((tool) => tool.name === 'update_published_post')?.annotations).toMatchObject({
      destructiveHint: true,
    });
    for (const name of ['update_published_post', 'publish_posts', 'unpublish_posts', 'trigger_deploy']) {
      const schema = JSON.stringify(tools.tools.find((tool) => tool.name === name)?.inputSchema);
      expect(schema).toContain('user_confirmed');
      expect(schema).toContain('true');
    }
    const updateSchema = tools.tools.find((tool) => tool.name === 'update_published_post')?.inputSchema;
    expect(JSON.stringify(updateSchema)).not.toContain('markdown');
    expect(JSON.stringify(updateSchema)).not.toContain('slug');

    const result = await client.callTool({ name: 'check_connection', arguments: {} });
    expect(result.structuredContent).toMatchObject({
      site: { title: 'Test Ghost' },
      configuration: { read_only: false, deploy_hook_configured: false },
    });

    const loaded = await client.callTool({ name: 'get_post', arguments: { id_or_slug: 'published-post' } });
    expect(loaded.structuredContent).toMatchObject({
      post: {
        title: 'Published post',
        custom_excerpt: null,
        feature_image: null,
        meta_title: null,
        meta_description: null,
        canonical_url: null,
        og_title: null,
        twitter_title: null,
      },
    });

    for (const user_confirmed of [undefined, false, 'true']) {
      const rejected = await client.callTool({
        name: 'update_published_post',
        arguments: {
          id,
          updated_at: updatedAt,
          patch: { meta_title: 'Must not be applied' },
          ...(user_confirmed === undefined ? {} : { user_confirmed }),
        },
      });
      expect(rejected.isError).toBe(true);
    }
    expect(edit).not.toHaveBeenCalled();

    const rejectedBody = await client.callTool({
      name: 'update_published_post',
      arguments: {
        id,
        updated_at: updatedAt,
        patch: { markdown: 'Body replacement is outside V1', meta_title: 'Must not be partially applied' },
        user_confirmed: true,
      },
    });
    expect(rejectedBody.isError).toBe(true);
    expect(edit).not.toHaveBeenCalled();

    const failedUpdate = await client.callTool({
      name: 'update_published_post',
      arguments: {
        id,
        updated_at: updatedAt,
        patch: { meta_title: 'Valid patch with a simulated Ghost failure' },
        user_confirmed: true,
      },
    });
    expect(failedUpdate.isError).toBe(true);
    expect(edit).toHaveBeenCalledOnce();
    expect(JSON.stringify(failedUpdate.content)).toContain('[REDACTED]');
    expect(JSON.stringify(failedUpdate.content)).not.toContain(config.ghostAdminApiKey);

    const publishAccepted = await client.callTool({
      name: 'publish_posts',
      arguments: { posts: [{ id, updated_at: updatedAt }], user_confirmed: true },
    });
    expect(JSON.stringify(publishAccepted.content)).not.toContain('Invalid arguments');
    const unpublishAccepted = await client.callTool({
      name: 'unpublish_posts',
      arguments: { posts: [{ id, updated_at: updatedAt }], user_confirmed: true },
    });
    expect(JSON.stringify(unpublishAccepted.content)).not.toContain('Invalid arguments');
    const deployAccepted = await client.callTool({
      name: 'trigger_deploy',
      arguments: { user_confirmed: true },
    });
    expect(JSON.stringify(deployAccepted.content)).not.toContain('Invalid arguments');

    await client.close();
    await server.close();
  });

  it('advertises exactly five tools in read-only mode', async () => {
    const publisher = new GhostPublisher(
      { ...config, readOnly: true },
      { ghost: { site: { read: async () => ({}) }, posts: {}, tags: {} } },
    );
    const { client, server } = await connect(publisher);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      ['check_connection', 'list_posts', 'get_post', 'list_tags', 'check_live_posts'].sort(),
    );

    await client.close();
    await server.close();
  });

  it('rejects absent or false confirmation on every destructive tool before side effects', async () => {
    const read = vi.fn(async () => post('draft'));
    const edit = vi.fn(async () => post('published'));
    const request = vi.fn(async () => new Response('', { status: 202 }));
    const publisher = new GhostPublisher(
      { ...config, deployHookUrl: 'https://deploy.example.com/private?token=hidden' },
      { ghost: { posts: { read, edit } }, fetch: request },
    );
    const { client, server } = await connect(publisher);
    const calls = [
      {
        name: 'update_published_post',
        arguments: { id, updated_at: updatedAt, patch: { meta_title: 'No write' } },
      },
      { name: 'publish_posts', arguments: { posts: [{ id, updated_at: updatedAt }] } },
      { name: 'unpublish_posts', arguments: { posts: [{ id, updated_at: updatedAt }] } },
      { name: 'trigger_deploy', arguments: {} },
    ];

    for (const call of calls) {
      for (const confirmation of [undefined, false]) {
        const result = await client.callTool({
          name: call.name,
          arguments: { ...call.arguments, ...(confirmation === undefined ? {} : { user_confirmed: confirmation }) },
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain('Invalid arguments');
      }
    }
    expect(read).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();

    await client.close();
    await server.close();
  });

  it('guards Markdown draft replacement at the MCP boundary but keeps metadata patches compatible', async () => {
    const read = vi.fn(async () => post('draft'));
    const edit = vi.fn(async (input: Record<string, unknown>) => ({ ...post('draft'), ...input }));
    const publisher = new GhostPublisher(config, { ghost: { posts: { read, edit } } });
    const { client, server } = await connect(publisher);

    const rejected = await client.callTool({
      name: 'update_draft',
      arguments: { id, updated_at: updatedAt, patch: { markdown: '# Replacement' } },
    });
    expect(rejected.isError).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();

    const metadata = await client.callTool({
      name: 'update_draft',
      arguments: { id, updated_at: updatedAt, patch: { excerpt: 'Metadata only' } },
    });
    expect(metadata.isError).not.toBe(true);
    expect(edit).toHaveBeenCalledOnce();

    await client.close();
    await server.close();
  });

  it('returns structured deployment failures without hiding successful transitions', async () => {
    const request = vi.fn(async () => new Response('failed', { status: 503 }));
    const edit = vi.fn(async ({ status }: { status: string }) => post(status as 'draft' | 'published'));
    const publisher = new GhostPublisher(
      { ...config, deployHookUrl: 'https://deploy.example.com/build?secret=hidden' },
      { ghost: { posts: { read: async () => post('draft'), edit } }, fetch: request },
    );
    const { client, server } = await connect(publisher);

    const result = await client.callTool({
      name: 'publish_posts',
      arguments: { posts: [{ id, updated_at: updatedAt }], user_confirmed: true },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      succeeded: [expect.objectContaining({ id, status: 'published' })],
      failed: [],
      partial_failure: false,
      deploy: {
        accepted: false,
        host: 'deploy.example.com',
        status: 503,
        error: 'Deploy hook returned HTTP 503',
      },
    });
    expect(request).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('secret=hidden');

    await client.close();
    await server.close();
  });
});
