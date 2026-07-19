import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { GhostPublisher } from '../src/publisher.js';
import { createServer } from '../src/server.js';

const config: Config = {
  ghostUrl: 'https://ghost.example.com',
  ghostAdminApiKey: `${'a'.repeat(24)}:${'b'.repeat(64)}`,
  ghostApiVersion: 'v5.0',
  uploadRoots: [],
};

describe('MCP contract', () => {
  it('advertises exactly twelve tools and returns structured content', async () => {
    const publisher = new GhostPublisher(config, {
      ghost: {
        site: { read: async () => ({ title: 'Test Ghost', url: 'https://ghost.example.com' }) },
        posts: {
          read: async () => ({
            id: 'a'.repeat(24),
            title: 'Published post',
            slug: 'published-post',
            status: 'published',
            updated_at: '2026-01-01T00:00:00.000Z',
            tags: [],
            html: '<p>Body</p>',
            lexical: '{"root":{"type":"root","children":[]}}',
          }),
          edit: async () => {
            throw new Error(`Ghost rejected ${config.ghostAdminApiKey}`);
          },
        },
      },
    });
    const server = createServer(publisher);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toHaveLength(12);
    expect(tools.tools.map((tool) => tool.name)).not.toContain('generate_image');
    expect(tools.tools.map((tool) => tool.name)).toContain('publish_posts');
    expect(tools.tools.find((tool) => tool.name === 'update_published_post')?.annotations).toMatchObject({
      destructiveHint: true,
    });
    const updateSchema = tools.tools.find((tool) => tool.name === 'update_published_post')?.inputSchema;
    expect(JSON.stringify(updateSchema)).not.toContain('markdown');
    expect(JSON.stringify(updateSchema)).not.toContain('slug');

    const result = await client.callTool({ name: 'check_connection', arguments: {} });
    expect(result.structuredContent).toMatchObject({
      site: { title: 'Test Ghost' },
      configuration: { deploy_hook_configured: false },
    });

    const post = await client.callTool({ name: 'get_post', arguments: { id_or_slug: 'published-post' } });
    expect(post.structuredContent).toMatchObject({
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

    const rejectedBody = await client.callTool({
      name: 'update_published_post',
      arguments: {
        id: 'a'.repeat(24),
        updated_at: '2026-01-01T00:00:00.000Z',
        patch: { markdown: 'Body replacement is outside V1', meta_title: 'Must not be partially applied' },
      },
    });
    expect(rejectedBody.isError).toBe(true);

    const failedUpdate = await client.callTool({
      name: 'update_published_post',
      arguments: {
        id: 'a'.repeat(24),
        updated_at: '2026-01-01T00:00:00.000Z',
        patch: { meta_title: 'Valid patch with a simulated Ghost failure' },
      },
    });
    expect(failedUpdate.isError).toBe(true);
    expect(JSON.stringify(failedUpdate.content)).toContain('[REDACTED]');
    expect(JSON.stringify(failedUpdate.content)).not.toContain(config.ghostAdminApiKey);

    await client.close();
    await server.close();
  });
});
