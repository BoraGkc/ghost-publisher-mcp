import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clientConfigPath,
  parseSetupOptions,
  runSetup,
  setupEntry,
} from '../src/setup.js';

const key = `${'a'.repeat(24)}:${'b'.repeat(64)}`;
const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function home() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ghost-publisher-setup-'));
  homes.push(directory);
  return directory;
}

function streams() {
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
  let text = '';
  stdout.on('data', (chunk) => (text += chunk.toString()));
  return { stdin, stdout, text: () => text };
}

const run = (command: string, args: string[]) => {
  if (command === 'which' && args[0] === 'npx') {
    return { status: 0, stdout: '/usr/local/bin/npx\n', stderr: '' };
  }
  return { status: 1, stdout: '', stderr: 'not found' };
};

describe('setup CLI', () => {
  it('accepts only bounded options and never a command-line key', () => {
    expect(
      parseSetupOptions([
        '--url',
        'https://example.com',
        '--client',
        'codex',
        '--client',
        'cursor',
        '--read-only',
      ]),
    ).toMatchObject({ clients: ['codex', 'cursor'], readOnly: true });
    expect(() => parseSetupOptions(['--client', 'other'])).toThrow('Unsupported setup client');
    expect(() => parseSetupOptions(['--key', key])).toThrow('Unknown option');
  });

  it('uses standard per-user JSON paths', () => {
    expect(clientConfigPath('cursor', 'linux', { HOME: '/home/test' })).toBe('/home/test/.cursor/mcp.json');
    expect(clientConfigPath('claude-desktop', 'darwin', { HOME: '/Users/test' })).toContain(
      'Library/Application Support/Claude/claude_desktop_config.json',
    );
    expect(() => clientConfigPath('claude-desktop', 'linux', { HOME: '/home/test' })).toThrow(
      'only on macOS and Windows',
    );
  });

  it('pins the exact package version and adds read-only only when requested', () => {
    expect(setupEntry('/usr/bin/npx', '0.2.1', 'https://example.com', key, false)).toEqual({
      command: '/usr/bin/npx',
      args: ['-y', 'ghost-publisher-mcp@0.2.1'],
      env: { GHOST_URL: 'https://example.com', GHOST_ADMIN_API_KEY: key },
    });
    expect(setupEntry('/usr/bin/npx', '0.2.1', 'https://example.com', key, true).env).toHaveProperty(
      'GHOST_READ_ONLY',
      'true',
    );
  });

  it('produces a redacted dry run without writing configuration', async () => {
    const directory = await home();
    const io = streams();
    await runSetup(
      [
        '--url',
        'https://example.com',
        '--client',
        'cursor',
        '--key-env',
        'TEST_GHOST_KEY',
        '--skip-connection-check',
        '--dry-run',
        '--yes',
      ],
      { env: { HOME: directory, TEST_GHOST_KEY: key }, platform: 'linux', run, ...io },
    );
    expect(io.text()).toContain('Key: [REDACTED]');
    expect(io.text()).not.toContain(key);
    await expect(readFile(path.join(directory, '.cursor', 'mcp.json'))).rejects.toThrow();
  });

  it('merges the Cursor entry without losing unrelated configuration', async () => {
    const directory = await home();
    const file = path.join(directory, '.cursor', 'mcp.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'other' } } }));
    const io = streams();
    await runSetup(
      [
        '--url',
        'https://example.com',
        '--client',
        'cursor',
        '--key-env',
        'TEST_GHOST_KEY',
        '--skip-connection-check',
        '--yes',
      ],
      { env: { HOME: directory, TEST_GHOST_KEY: key }, platform: 'linux', run, ...io },
    );
    const config = JSON.parse(await readFile(file, 'utf8'));
    expect(config.theme).toBe('dark');
    expect(config.mcpServers.other).toEqual({ command: 'other' });
    expect(config.mcpServers['ghost-publisher']).toMatchObject({
      args: ['-y', 'ghost-publisher-mcp@0.2.1'],
      env: { GHOST_URL: 'https://example.com', GHOST_ADMIN_API_KEY: key },
    });
    expect(io.text()).not.toContain(key);
  });

  it('refuses conflicts without changing the original', async () => {
    const directory = await home();
    const file = path.join(directory, '.cursor', 'mcp.json');
    const original = JSON.stringify({ mcpServers: { 'ghost-publisher': { command: 'old' } } });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, original);
    const io = streams();
    await expect(
      runSetup(
        [
          '--url',
          'https://example.com',
          '--client',
          'cursor',
          '--key-env',
          'TEST_GHOST_KEY',
          '--skip-connection-check',
          '--yes',
        ],
        { env: { HOME: directory, TEST_GHOST_KEY: key }, platform: 'linux', run, ...io },
      ),
    ).rejects.toThrow('require --replace');
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('rolls back an earlier client when a later client write fails', async () => {
    const directory = await home();
    const cursor = path.join(directory, '.cursor', 'mcp.json');
    const original = JSON.stringify({ mcpServers: { other: { command: 'other' } } });
    await mkdir(path.dirname(cursor), { recursive: true });
    await writeFile(cursor, original);
    const claudeParent = path.join(directory, 'Library', 'Application Support');
    await mkdir(claudeParent, { recursive: true });
    await writeFile(path.join(claudeParent, 'Claude'), 'blocks directory creation');
    const io = streams();
    await expect(
      runSetup(
        [
          '--url',
          'https://example.com',
          '--client',
          'cursor',
          '--client',
          'claude-desktop',
          '--key-env',
          'TEST_GHOST_KEY',
          '--skip-connection-check',
          '--yes',
        ],
        { env: { HOME: directory, TEST_GHOST_KEY: key }, platform: 'darwin', run, ...io },
      ),
    ).rejects.toThrow();
    expect(await readFile(cursor, 'utf8')).toBe(original);
  });
});
