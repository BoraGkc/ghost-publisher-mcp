#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { GhostPublisher } from './publisher.js';
import { createServer } from './server.js';

try {
  if (process.argv[2] === 'setup') {
    const { runSetup } = await import('./setup.js');
    await runSetup(process.argv.slice(3));
  } else {
    const publisher = new GhostPublisher(loadConfig());
    const server = createServer(publisher);
    await server.connect(new StdioServerTransport());
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ghost-publisher-mcp: ${message}`);
  process.exitCode = 1;
}
