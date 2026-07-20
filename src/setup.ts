import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { GhostPublisher } from './publisher.js';

export type SetupClient = 'codex' | 'cursor' | 'claude-desktop';

type CommandResult = { status: number; stdout: string; stderr: string };
type Runner = (command: string, args: string[]) => CommandResult;
type SetupEntry = { command: string; args: string[]; env: Record<string, string> };
type JsonState = {
  client: Exclude<SetupClient, 'codex'>;
  file: string;
  directoryExisted: boolean;
  existed: boolean;
  original?: Buffer;
  mode?: number;
  document: Record<string, unknown>;
  state: 'new' | 'same' | 'conflict';
};

type SetupDependencies = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  run?: Runner;
};

const SERVER_NAME = 'ghost-publisher';
const CLIENTS = new Set<SetupClient>(['codex', 'cursor', 'claude-desktop']);

const defaultRun: Runner = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
};

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function refuseSymlink(file: string, label: string): Promise<void> {
  try {
    if ((await lstat(file)).isSymbolicLink()) {
      throw new Error(`${label} configuration must not be a symbolic link`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function homeDirectory(env: NodeJS.ProcessEnv): string {
  const home = env.HOME || env.USERPROFILE;
  if (!home) throw new Error('Cannot determine the user home directory');
  return home;
}

export function clientConfigPath(
  client: Exclude<SetupClient, 'codex'>,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string {
  const home = homeDirectory(env);
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  if (client === 'cursor') return platformPath.join(home, '.cursor', 'mcp.json');
  if (platform === 'darwin') {
    return platformPath.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (platform === 'win32' && env.APPDATA) {
    return platformPath.join(env.APPDATA, 'Claude', 'claude_desktop_config.json');
  }
  throw new Error('Claude Desktop setup is supported only on macOS and Windows');
}

function executable(name: string, platform: NodeJS.Platform, run: Runner): string | undefined {
  const result = run(platform === 'win32' ? 'where' : 'which', [name]);
  if (result.status !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

export function parseSetupOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      url: { type: 'string' },
      client: { type: 'string', multiple: true },
      'read-only': { type: 'boolean', default: false },
      'key-env': { type: 'string' },
      replace: { type: 'boolean', default: false },
      'skip-connection-check': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
    },
  });
  const clients = (values.client ?? []).map((client) => {
    if (!CLIENTS.has(client as SetupClient)) throw new Error(`Unsupported setup client: ${client}`);
    return client as SetupClient;
  });
  if (new Set(clients).size !== clients.length) throw new Error('Setup clients must be unique');
  return {
    url: values.url,
    clients,
    readOnly: values['read-only'] ?? false,
    keyEnv: values['key-env'],
    replace: values.replace ?? false,
    skipConnectionCheck: values['skip-connection-check'] ?? false,
    dryRun: values['dry-run'] ?? false,
    yes: values.yes ?? false,
  };
}

async function packageVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    version?: string;
  };
  if (!packageJson.version) throw new Error('Package version is unavailable');
  return packageJson.version;
}

export function setupEntry(
  command: string,
  version: string,
  ghostUrl: string,
  key: string,
  readOnly: boolean,
): SetupEntry {
  return {
    command,
    args: ['-y', `ghost-publisher-mcp@${version}`],
    env: {
      GHOST_URL: ghostUrl,
      GHOST_ADMIN_API_KEY: key,
      ...(readOnly ? { GHOST_READ_ONLY: 'true' } : {}),
    },
  };
}

async function hiddenKey(input: NodeJS.ReadStream, output: NodeJS.WriteStream): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('A TTY is required to enter the key; use --key-env for non-interactive setup');
  }
  output.write('Ghost Admin API key: ');
  const wasRaw = input.isRaw;
  const wasPaused = input.isPaused();
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      input.off('data', onData);
      input.setRawMode(Boolean(wasRaw));
      if (wasPaused) input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003') return finish(new Error('Setup cancelled'));
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else value += character;
      }
    };
    input.on('data', onData);
  });
}

async function prompt(question: string, input: NodeJS.ReadStream, output: NodeJS.WriteStream): Promise<string> {
  const terminal = createInterface({ input, output });
  try {
    return (await terminal.question(question)).trim();
  } finally {
    terminal.close();
  }
}

async function detectClients(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  run: Runner,
): Promise<SetupClient[]> {
  const detected: SetupClient[] = [];
  if (executable('codex', platform, run)) detected.push('codex');
  if (
    executable('cursor', platform, run) ||
    executable('cursor-agent', platform, run) ||
    (await exists(path.dirname(clientConfigPath('cursor', platform, env))))
  ) {
    detected.push('cursor');
  }
  if (platform === 'darwin' || platform === 'win32') {
    const config = clientConfigPath('claude-desktop', platform, env);
    const appExists =
      platform === 'darwin'
        ? await exists('/Applications/Claude.app')
        : Boolean(env.LOCALAPPDATA && (await exists(path.join(env.LOCALAPPDATA, 'Programs', 'Claude'))));
    if (appExists || (await exists(path.dirname(config)))) detected.push('claude-desktop');
  }
  return detected;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJsonState(
  client: Exclude<SetupClient, 'codex'>,
  file: string,
  desired: SetupEntry,
): Promise<JsonState> {
  await refuseSymlink(file, client);
  const directoryExisted = await exists(path.dirname(file));
  const existed = await exists(file);
  let original: Buffer | undefined;
  let mode: number | undefined;
  let document: Record<string, unknown> = {};
  if (existed) {
    original = await readFile(file);
    mode = (await stat(file)).mode & 0o777;
    const parsed = JSON.parse(original.toString('utf8')) as unknown;
    if (!plainObject(parsed)) throw new Error(`${client} configuration must contain a JSON object`);
    document = parsed;
  }
  const servers = document.mcpServers;
  if (servers !== undefined && !plainObject(servers)) {
    throw new Error(`${client} mcpServers must contain a JSON object`);
  }
  const current = plainObject(servers) ? servers[SERVER_NAME] : undefined;
  return {
    client,
    file,
    directoryExisted,
    existed,
    original,
    mode,
    document,
    state: current === undefined ? 'new' : isDeepStrictEqual(current, desired) ? 'same' : 'conflict',
  };
}

function codexEntry(value: unknown): unknown {
  if (!plainObject(value)) return undefined;
  const transport = plainObject(value.transport) ? value.transport : value;
  return {
    command: transport.command,
    args: transport.args ?? [],
    env: transport.env ?? {},
  };
}

function codexState(codex: string, desired: SetupEntry, run: Runner): 'new' | 'same' | 'conflict' {
  const current = run(codex, ['mcp', 'get', SERVER_NAME, '--json']);
  if (current.status !== 0) {
    if (/not found|no mcp server/i.test(current.stderr)) return 'new';
    throw new Error(`Cannot inspect Codex MCP configuration: ${current.stderr.trim() || 'unknown error'}`);
  }
  const parsed = JSON.parse(current.stdout) as unknown;
  return isDeepStrictEqual(codexEntry(parsed), desired) ? 'same' : 'conflict';
}

function privateMode(mode?: number): number {
  if (mode === undefined) return 0o600;
  return mode & 0o600 || 0o600;
}

async function atomicJson(state: JsonState, desired: SetupEntry): Promise<void> {
  const directory = path.dirname(state.file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const servers = plainObject(state.document.mcpServers) ? state.document.mcpServers : {};
  const next = { ...state.document, mcpServers: { ...servers, [SERVER_NAME]: desired } };
  const temporary = `${state.file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
      mode: privateMode(state.mode),
      flag: 'wx',
    });
    await rename(temporary, state.file);
    if (process.platform !== 'win32') await chmod(state.file, privateMode(state.mode));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function restoreJson(state: JsonState): Promise<void> {
  if (state.existed && state.original) {
    const temporary = `${state.file}.${randomUUID()}.restore`;
    try {
      await writeFile(temporary, state.original, { mode: privateMode(state.mode), flag: 'wx' });
      await rename(temporary, state.file);
      if (process.platform !== 'win32') await chmod(state.file, privateMode(state.mode));
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  } else {
    await rm(state.file, { force: true });
    if (!state.directoryExisted) {
      try {
        await rmdir(path.dirname(state.file));
      } catch {
        // The directory is no longer empty or was removed elsewhere.
      }
    }
  }
}

function addCodex(codex: string, entry: SetupEntry, run: Runner): void {
  const environment = Object.entries(entry.env).flatMap(([name, value]) => ['--env', `${name}=${value}`]);
  const result = run(codex, [
    'mcp',
    'add',
    SERVER_NAME,
    ...environment,
    '--',
    entry.command,
    ...entry.args,
  ]);
  if (result.status !== 0) throw new Error(`Codex setup failed: ${result.stderr.trim() || 'unknown error'}`);
}

async function replaceCodexKey(file: string, placeholder: string, key: string, mode?: number): Promise<void> {
  const current = await readFile(file, 'utf8');
  if (current.split(placeholder).length !== 2) {
    throw new Error('Codex configuration did not contain exactly one temporary key placeholder');
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, current.replace(placeholder, key), {
      mode: privateMode(mode),
      flag: 'wx',
    });
    await rename(temporary, file);
    if (process.platform !== 'win32') await chmod(file, privateMode(mode));
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function safeMessage(error: unknown, key: string): string {
  return (error instanceof Error ? error.message : String(error)).replaceAll(key, '[REDACTED]');
}

export async function runSetup(args: string[], dependencies: SetupDependencies = {}): Promise<void> {
  const env = dependencies.env ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const input = dependencies.stdin ?? process.stdin;
  const output = dependencies.stdout ?? process.stdout;
  const run = dependencies.run ?? defaultRun;
  const options = parseSetupOptions(args);
  const interactive = Boolean(input.isTTY && output.isTTY);

  if (!interactive && (!options.url || !options.clients.length || !options.keyEnv || !options.yes)) {
    throw new Error('Non-interactive setup requires --url, --client, --key-env, and --yes');
  }

  const url = options.url ?? (await prompt('Ghost Admin URL: ', input, output));
  const key = options.keyEnv ? env[options.keyEnv] : await hiddenKey(input, output);
  if (!key) throw new Error(`Environment variable ${options.keyEnv ?? ''} does not contain a Ghost Admin key`);

  try {
    const config = loadConfig({
      GHOST_URL: url,
      GHOST_ADMIN_API_KEY: key,
      ...(options.readOnly ? { GHOST_READ_ONLY: 'true' } : {}),
    });
    const clients = options.clients.length ? options.clients : await detectClients(platform, env, run);
    if (!clients.length) throw new Error('No supported clients detected; pass one or more --client options');
    if (clients.includes('claude-desktop') && platform !== 'darwin' && platform !== 'win32') {
      throw new Error('Claude Desktop setup is supported only on macOS and Windows');
    }

    const npx = executable(platform === 'win32' ? 'npx.cmd' : 'npx', platform, run);
    if (!npx) throw new Error('npx is required and could not be resolved');
    const version = await packageVersion();
    const desired = setupEntry(npx, version, config.ghostUrl, key, config.readOnly);
    const codex = clients.includes('codex') ? executable('codex', platform, run) : undefined;
    if (clients.includes('codex') && !codex) throw new Error('Codex CLI is required to configure Codex');
    const codexHome = env.CODEX_HOME || path.join(homeDirectory(env), '.codex');
    const codexConfig = path.join(codexHome, 'config.toml');
    if (codex) await refuseSymlink(codexConfig, 'Codex');

    if (!options.skipConnectionCheck) await new GhostPublisher(config).checkConnection();

    const jsonStates = await Promise.all(
      clients
        .filter((client): client is Exclude<SetupClient, 'codex'> => client !== 'codex')
        .map((client) => readJsonState(client, clientConfigPath(client, platform, env), desired)),
    );
    const currentCodex = codex ? codexState(codex, desired, run) : undefined;
    const conflicts = [
      ...jsonStates.filter((state) => state.state === 'conflict').map((state) => state.client),
      ...(currentCodex === 'conflict' ? ['codex' as const] : []),
    ];

    output.write(`Ghost: ${config.ghostUrl}\nClients: ${clients.join(', ')}\nMode: ${config.readOnly ? 'read-only' : 'editorial'}\nKey: [REDACTED]\n`);
    if (conflicts.length) output.write(`Existing entries differ: ${conflicts.join(', ')}\n`);
    if (options.dryRun) {
      output.write('Dry run complete; no configuration changed.\n');
      return;
    }
    if (conflicts.length && !options.replace) {
      if (!interactive || options.yes) throw new Error('Existing entries require --replace');
      if ((await prompt('Replace the differing entries? [y/N] ', input, output)).toLowerCase() !== 'y') {
        throw new Error('Setup cancelled');
      }
    }
    if (!options.yes && interactive) {
      output.write('The Ghost Admin key will be stored in each selected client configuration.\n');
      if ((await prompt('Apply these changes? [y/N] ', input, output)).toLowerCase() !== 'y') {
        throw new Error('Setup cancelled');
      }
    }

    const codexExisted = codex ? await exists(codexConfig) : false;
    const codexOriginal = codexExisted ? await readFile(codexConfig) : undefined;
    const codexMode = codexExisted ? (await stat(codexConfig)).mode & 0o777 : undefined;
    const changedJson: JsonState[] = [];
    let attemptedCodex = false;
    try {
      for (const state of jsonStates) {
        if (state.state === 'same') continue;
        changedJson.push(state);
        await atomicJson(state, desired);
      }
      if (codex && currentCodex !== 'same') {
        attemptedCodex = true;
        if (currentCodex === 'conflict') {
          const removed = run(codex, ['mcp', 'remove', SERVER_NAME]);
          if (removed.status !== 0) throw new Error(`Cannot replace Codex entry: ${removed.stderr.trim()}`);
        }
        const placeholder = `ghost-publisher-key-${randomUUID()}`;
        addCodex(
          codex,
          {
            ...desired,
            env: { ...desired.env, GHOST_ADMIN_API_KEY: placeholder },
          },
          run,
        );
        await replaceCodexKey(codexConfig, placeholder, key, codexMode);
      }
      for (const state of jsonStates) {
        const readback = await readJsonState(state.client, state.file, desired);
        if (readback.state !== 'same') throw new Error(`${state.client} configuration verification failed`);
      }
      if (codex && codexState(codex, desired, run) !== 'same') {
        throw new Error('Codex configuration verification failed');
      }
    } catch (error) {
      let rollbackFailed = false;
      for (const state of changedJson.reverse()) {
        try {
          await restoreJson(state);
        } catch {
          rollbackFailed = true;
        }
      }
      try {
        if (attemptedCodex) {
          if (codexExisted && codexOriginal) {
            await mkdir(codexHome, { recursive: true, mode: 0o700 });
            const temporary = `${codexConfig}.${randomUUID()}.restore`;
            try {
              await writeFile(temporary, codexOriginal, { mode: privateMode(codexMode), flag: 'wx' });
              await rename(temporary, codexConfig);
              if (process.platform !== 'win32') await chmod(codexConfig, privateMode(codexMode));
            } finally {
              await rm(temporary, { force: true }).catch(() => undefined);
            }
          } else {
            await rm(codexConfig, { force: true });
          }
        }
      } catch {
        rollbackFailed = true;
      }
      if (rollbackFailed) throw new Error(`${error instanceof Error ? error.message : String(error)}; rollback was incomplete`);
      throw error;
    }

    output.write('Setup complete. Restart the selected clients, then ask: Check my Ghost connection. Do not change anything.\n');
  } catch (error) {
    throw new Error(safeMessage(error, key));
  }
}
