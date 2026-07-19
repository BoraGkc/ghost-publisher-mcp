#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { GhostPublisher } from './publisher.js';
import { createServer } from './server.js';

try {
  const publisher = new GhostPublisher(loadConfig());
  const server = createServer(publisher);
  await server.connect(new StdioServerTransport());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ghost-publisher-mcp: ${message}`);
  process.exitCode = 1;
}
