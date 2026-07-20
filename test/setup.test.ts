import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const packageVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string })
  .version;
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
    expect(
      clientConfigPath('claude-desktop', 'win32', {
        USERPROFILE: 'C:\\Users\\test',
        APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
      }),
    ).toBe('C:\\Users\\test\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
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
      args: ['-y', `ghost-publisher-mcp@${packageVersion}`],
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

  it('removes a partially written new Codex configuration when native setup fails', async () => {
    const directory = await home();
    const codexConfig = path.join(directory, '.codex', 'config.toml');
    const io = streams();
    const failingCodex = (command: string, args: string[]) => {
      if (command === 'which') {
        if (args[0] === 'npx') return { status: 0, stdout: '/usr/local/bin/npx\n', stderr: '' };
        if (args[0] === 'codex') return { status: 0, stdout: '/usr/local/bin/codex\n', stderr: '' };
      }
      if (command === '/usr/local/bin/codex' && args.slice(0, 3).join(' ') === 'mcp get ghost-publisher') {
        return { status: 1, stdout: '', stderr: 'MCP server not found' };
      }
      if (command === '/usr/local/bin/codex' && args.slice(0, 3).join(' ') === 'mcp add ghost-publisher') {
        const temporaryKey = args.find((arg) => arg.startsWith('GHOST_ADMIN_API_KEY='))?.split('=')[1];
        mkdirSync(path.dirname(codexConfig), { recursive: true });
        writeFileSync(codexConfig, `partial ${temporaryKey}`);
        return { status: 1, stdout: '', stderr: 'failed after writing temporary key' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected command' };
    };

    await expect(
      runSetup(
        [
          '--url',
          'https://example.com',
          '--client',
          'codex',
          '--key-env',
          'TEST_GHOST_KEY',
          '--skip-connection-check',
          '--yes',
        ],
        {
          env: { HOME: directory, TEST_GHOST_KEY: key },
          platform: 'linux',
          run: failingCodex,
          ...io,
        },
      ),
    ).rejects.toThrow('Codex setup failed: failed after writing temporary key');
    await expect(readFile(codexConfig)).rejects.toThrow();
    expect(io.text()).not.toContain(key);
  });

  it('keeps the Ghost key out of Codex process arguments', async () => {
    const directory = await home();
    const codexConfig = path.join(directory, '.codex', 'config.toml');
    const io = streams();
    let added = false;
    let addArguments: string[] = [];
    const codexRun = (command: string, args: string[]) => {
      if (command === 'which') {
        if (args[0] === 'npx') return { status: 0, stdout: '/usr/local/bin/npx\n', stderr: '' };
        if (args[0] === 'codex') return { status: 0, stdout: '/usr/local/bin/codex\n', stderr: '' };
      }
      if (command === '/usr/local/bin/codex' && args.slice(0, 3).join(' ') === 'mcp get ghost-publisher') {
        if (!added) return { status: 1, stdout: '', stderr: 'MCP server not found' };
        const saved = readFileSync(codexConfig, 'utf8');
        return {
          status: 0,
          stdout: JSON.stringify({
            command: '/usr/local/bin/npx',
            args: ['-y', `ghost-publisher-mcp@${packageVersion}`],
            env: {
              GHOST_URL: 'https://example.com',
              GHOST_ADMIN_API_KEY: saved.includes(key) ? key : 'not-replaced',
            },
          }),
          stderr: '',
        };
      }
      if (command === '/usr/local/bin/codex' && args.slice(0, 3).join(' ') === 'mcp add ghost-publisher') {
        addArguments = args;
        const temporaryKey = args.find((arg) => arg.startsWith('GHOST_ADMIN_API_KEY='))?.split('=')[1];
        mkdirSync(path.dirname(codexConfig), { recursive: true });
        writeFileSync(codexConfig, `GHOST_ADMIN_API_KEY = "${temporaryKey}"\n`, { mode: 0o600 });
        added = true;
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected command' };
    };

    await runSetup(
      [
        '--url',
        'https://example.com',
        '--client',
        'codex',
        '--key-env',
        'TEST_GHOST_KEY',
        '--skip-connection-check',
        '--yes',
      ],
      { env: { HOME: directory, TEST_GHOST_KEY: key }, platform: 'linux', run: codexRun, ...io },
    );

    expect(addArguments.join(' ')).not.toContain(key);
    expect(addArguments.join(' ')).toContain('ghost-publisher-key-');
    expect(await readFile(codexConfig, 'utf8')).toContain(key);
    expect(await readFile(codexConfig, 'utf8')).not.toContain('ghost-publisher-key-');
    expect(io.text()).not.toContain(key);
  });

  it.skipIf(process.platform === 'win32')('refuses symlinked client configurations without changing their targets', async () => {
    const directory = await home();
    const target = path.join(directory, 'managed.json');
    const file = path.join(directory, '.cursor', 'mcp.json');
    const original = JSON.stringify({ mcpServers: { other: { command: 'other' } } });
    await writeFile(target, original);
    await mkdir(path.dirname(file), { recursive: true });
    await symlink(target, file);
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
    ).rejects.toThrow('configuration must not be a symbolic link');
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, 'utf8')).toBe(original);
  });

  it.skipIf(process.platform === 'win32')('refuses a symlinked Codex configuration before invoking Codex', async () => {
    const directory = await home();
    const target = path.join(directory, 'managed.toml');
    const file = path.join(directory, '.codex', 'config.toml');
    const original = '[mcp_servers.other]\ncommand = "other"\n';
    await writeFile(target, original);
    await mkdir(path.dirname(file), { recursive: true });
    await symlink(target, file);
    const io = streams();
    const calls: string[] = [];
    const codexRun = (command: string, args: string[]) => {
      calls.push([command, ...args].join(' '));
      if (command === 'which' && args[0] === 'npx') {
        return { status: 0, stdout: '/usr/local/bin/npx\n', stderr: '' };
      }
      if (command === 'which' && args[0] === 'codex') {
        return { status: 0, stdout: '/usr/local/bin/codex\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected command' };
    };

    await expect(
      runSetup(
        [
          '--url',
          'https://example.com',
          '--client',
          'codex',
          '--key-env',
          'TEST_GHOST_KEY',
          '--skip-connection-check',
          '--yes',
        ],
        { env: { HOME: directory, TEST_GHOST_KEY: key }, platform: 'linux', run: codexRun, ...io },
      ),
    ).rejects.toThrow('Codex configuration must not be a symbolic link');
    expect(calls.some((call) => call.includes('mcp get'))).toBe(false);
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, 'utf8')).toBe(original);
  });
});
