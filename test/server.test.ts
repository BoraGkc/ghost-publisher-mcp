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
  it('advertises exactly eleven tools and returns structured content', async () => {
    const publisher = new GhostPublisher(config, {
      ghost: { site: { read: async () => ({ title: 'Test Ghost', url: 'https://ghost.example.com' }) } },
    });
    const server = createServer(publisher);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toHaveLength(11);
    expect(tools.tools.map((tool) => tool.name)).not.toContain('generate_image');
    expect(tools.tools.map((tool) => tool.name)).toContain('publish_posts');

    const result = await client.callTool({ name: 'check_connection', arguments: {} });
    expect(result.structuredContent).toMatchObject({
      site: { title: 'Test Ghost' },
      configuration: { deploy_hook_configured: false },
    });

    await client.close();
    await server.close();
  });
});
