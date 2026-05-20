import { type ChildProcess, fork, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_MARKERS } from '../src/detect-agent';
import type { ParentToSenderPayload } from '../src/payload';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(TEST_DIR);
const REPO_ROOT = resolve(PACKAGE_DIR, '../../../..');
const BACKEND_DIR = join(REPO_ROOT, 'apps', 'telemetry-backend');
const SENDER_PATH = resolve(PACKAGE_DIR, 'dist', 'sender.mjs');

interface TelemetryEventRow {
  readonly installationId: string;
  readonly version: string;
  readonly command: string;
  readonly flags: readonly string[];
  readonly runtimeName: string;
  readonly runtimeVersion: string;
  readonly os: string;
  readonly arch: string;
  readonly packageManager: string | null;
  readonly databaseTarget: string | null;
  readonly tsVersion: string | null;
  readonly agent: string | null;
  readonly extensions: readonly string[];
}

interface BackendProcess {
  readonly child: ChildProcess;
  readonly stdout: string[];
  readonly stderr: string[];
}

let database: DevDatabase;
let backend: BackendProcess | undefined;
let endpointBase: string;
let projectDir: string;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('ephemeral port server did not bind to a TCP address'));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

function runCommand(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): Promise<void> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk.toString('utf-8')));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf-8')));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} exited ${code ?? 'without a code'}\n${stdout.join('')}\n${stderr.join('')}`,
        ),
      );
    });
  });
}

async function initializeBackendSchema(): Promise<void> {
  await runCommand(
    'pnpm',
    [
      '--filter',
      '@prisma-next/telemetry-backend',
      'exec',
      'prisma-next',
      'db',
      'init',
      '--db',
      database.connectionString,
      '--json',
      '--no-color',
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: database.connectionString },
    },
  );
}

function startBackend(port: number): BackendProcess {
  const child = spawn('bun', ['run', 'src/server.ts'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: database.connectionString,
      PORT: String(port),
      RATE_LIMIT_RPM: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk.toString('utf-8')));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf-8')));
  return { child, stdout, stderr };
}

async function waitForBackendReady(): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (backend?.child.exitCode !== null && backend?.child.exitCode !== undefined) {
      throw new Error(
        `telemetry backend exited early\n${backend.stdout.join('')}\n${backend.stderr.join('')}`,
      );
    }
    try {
      const response = await fetch(`${endpointBase}/events`, { method: 'GET' });
      if (response.status === 405) {
        return;
      }
    } catch {
      // retry until the process binds the port
    }
    await sleep(50);
  }
  throw new Error(
    `telemetry backend did not become ready\n${backend?.stdout.join('') ?? ''}\n${backend?.stderr.join('') ?? ''}`,
  );
}

async function stopBackend(): Promise<void> {
  const proc = backend;
  backend = undefined;
  if (proc === undefined || proc.child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolveStop) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveStop();
    };
    const timer = setTimeout(() => {
      proc.child.kill('SIGKILL');
      finish();
    }, 5000);
    proc.child.once('exit', finish);
    proc.child.kill('SIGTERM');
  });
}

async function clearRows(): Promise<void> {
  await withClient(database.connectionString, async (client) => {
    await client.query('delete from telemetry_event');
  });
}

async function readRows(): Promise<TelemetryEventRow[]> {
  return withClient(database.connectionString, async (client) => {
    const { rows } = await client.query<TelemetryEventRow>(
      'select "installationId", version, command, flags, "runtimeName", "runtimeVersion", os, arch, "packageManager", "databaseTarget", "tsVersion", agent, extensions from telemetry_event order by id asc',
    );
    return rows;
  });
}

async function awaitRows(expectedCount: number, timeoutMs = 5000): Promise<TelemetryEventRow[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const rows = await readRows();
    if (rows.length === expectedCount) {
      return rows;
    }
    await sleep(25);
  }
  const rows = await readRows();
  throw new Error(`expected ${expectedCount} telemetry row(s), found ${rows.length}`);
}

function buildPayload(overrides: Partial<ParentToSenderPayload> = {}): ParentToSenderPayload {
  return {
    installationId: '00000000-0000-4000-8000-000000000001',
    version: '0.9.0',
    command: 'migration new',
    flags: ['name', 'dry-run'],
    databaseTarget: 'postgres',
    extensions: ['pgvector', 'paradedb'],
    projectRoot: projectDir,
    endpoint: `${endpointBase}/events`,
    ...overrides,
  };
}

function spawnSenderDirect(
  payload: ParentToSenderPayload,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return new Promise((resolveSender, reject) => {
    const child = fork(SENDER_PATH, [], {
      stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
      env,
    });
    child.on('error', reject);
    child.on('exit', () => resolveSender());
    child.send(payload);
  });
}

function envWithoutAgentMarkers(): NodeJS.ProcessEnv {
  const baseEnv = { ...process.env };
  for (const marker of AGENT_MARKERS) {
    delete baseEnv[marker.envVar];
  }
  return baseEnv;
}

beforeAll(async () => {
  database = await createDevDatabase();
  await initializeBackendSchema();
  const port = await freePort();
  endpointBase = `http://127.0.0.1:${port}`;
  backend = startBackend(port);
  await waitForBackendReady();
  projectDir = mkdtempSync(join(tmpdir(), 'cli-telemetry-int-project-'));
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'fixture', devDependencies: { typescript: '^5.9.3' } }),
  );
}, timeouts.spinUpPpgDev);

beforeEach(async () => {
  await clearRows();
});

afterAll(async () => {
  await stopBackend();
  if (projectDir !== undefined) {
    rmSync(projectDir, { recursive: true, force: true });
  }
  if (database !== undefined) {
    await database.close();
  }
}, timeouts.spinUpPpgDev);

describe('cli-telemetry end-to-end via telemetry backend', () => {
  it('forks the sender, the child POSTs the event, and the backend stores the wire shape', async () => {
    await spawnSenderDirect(buildPayload());
    const [row] = await awaitRows(1);

    expect(row?.installationId).toBe('00000000-0000-4000-8000-000000000001');
    expect(row?.version).toBe('0.9.0');
    expect(row?.command).toBe('migration new');
    expect(row?.flags).toEqual(['name', 'dry-run']);
    expect(row?.databaseTarget).toBe('postgres');
    expect(row?.extensions).toEqual(['pgvector', 'paradedb']);
    expect(typeof row?.runtimeName).toBe('string');
    expect(typeof row?.runtimeVersion).toBe('string');
    expect(typeof row?.os).toBe('string');
    expect(typeof row?.arch).toBe('string');
    expect(row?.tsVersion).toBe('5.9.3');
  });

  it('transmits only flag names, never values or positionals', async () => {
    const sensitiveFlags = ['connection-string', 'name', 'config'];
    await spawnSenderDirect(buildPayload({ flags: sensitiveFlags }));
    const [row] = await awaitRows(1);

    expect(row?.flags).toEqual(sensitiveFlags);
    const serialised = JSON.stringify(row);
    expect(serialised).not.toMatch(/postgres:\/\/u:p@h\/d/);
    expect(serialised).not.toMatch(/customer-acme-payments/);
    expect(serialised).not.toMatch(/\/Users\/alice\/secrets/);
  });

  it('round-trips a string[] of declared extension-pack ids verbatim', async () => {
    await spawnSenderDirect(
      buildPayload({ extensions: ['pgvector', 'paradedb', 'myorg-custom-ext'] }),
    );
    const [row] = await awaitRows(1);
    expect(row?.extensions).toEqual(['pgvector', 'paradedb', 'myorg-custom-ext']);
  });

  it('populates the agent field from the child env', async () => {
    await spawnSenderDirect(buildPayload(), { ...process.env, CLAUDECODE: '1' });
    const [row] = await awaitRows(1);
    expect(row?.agent).toBe('Claude Code');
  });

  it('populates the agent field for Gemini CLI sessions', async () => {
    await spawnSenderDirect(buildPayload(), { ...process.env, GEMINI_CLI: '1' });
    const [row] = await awaitRows(1);
    expect(row?.agent).toBe('Gemini CLI');
  });

  it('passes null agent when no marker env var is set', async () => {
    await spawnSenderDirect(buildPayload(), envWithoutAgentMarkers());
    const [row] = await awaitRows(1);
    expect(row?.agent).toBeNull();
  });

  it('produces a backend-accepted row containing the required field set', async () => {
    await spawnSenderDirect(buildPayload());
    const [row] = await awaitRows(1);
    const required = [
      row?.installationId,
      row?.version,
      row?.command,
      row?.runtimeName,
      row?.runtimeVersion,
      row?.os,
      row?.arch,
    ];
    for (const field of required) {
      expect(typeof field).toBe('string');
      expect(field?.length).toBeGreaterThan(0);
    }
  });
});

describe('cli-telemetry end-to-end — failure modes are silent', () => {
  it('the sender swallows a network failure (parent never knows)', async () => {
    const payload = buildPayload({ endpoint: 'http://127.0.0.1:1/events' });
    await new Promise<void>((resolveSender, reject) => {
      const child = fork(SENDER_PATH, [], {
        stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        expect(code).toBe(0);
        resolveSender();
      });
      child.send(payload);
    });
  });

  it('the sender exits 0 when no payload is received within the idle timeout', async () => {
    await new Promise<void>((resolveSender, reject) => {
      const child = fork(SENDER_PATH, [], {
        stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        expect(code).toBe(0);
        resolveSender();
      });
      setTimeout(() => child.disconnect(), 50);
    });
  }, 10_000);
});
