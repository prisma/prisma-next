import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createDevDatabase, type DevDatabase, withClient } from '@prisma-next/test-utils';
import { dirname, join, resolve } from 'pathe';

/**
 * Shared end-to-end harness around the real Bun telemetry backend.
 *
 * Both `integration.test.ts` (which forks the sender script directly)
 * and `cli-e2e.test.ts` (which spawns the compiled `prisma-next` binary)
 * stand up the same surface: a fresh dev Postgres database, the
 * backend's contract schema initialised against it, the
 * `apps/telemetry-backend` HTTP service started on an ephemeral port,
 * and a `clearRows` / `awaitRows` helper pair for assertion. The
 * harness lives in its own module so the lifecycle is described once
 * and the test files differ only in how they exercise the wire.
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = dirname(TEST_DIR);
const REPO_ROOT = resolve(PACKAGE_DIR, '../../../..');
const BACKEND_DIR = join(REPO_ROOT, 'apps', 'telemetry-backend');
const SENDER_PATH = resolve(PACKAGE_DIR, 'dist', 'sender.mjs');
const CLI_DIR = resolve(REPO_ROOT, 'packages', '1-framework', '3-tooling', 'cli');
const CLI_BIN_PATH = resolve(CLI_DIR, 'dist', 'cli.js');

export const HARNESS_PATHS = {
  TEST_DIR,
  PACKAGE_DIR,
  REPO_ROOT,
  BACKEND_DIR,
  SENDER_PATH,
  CLI_DIR,
  CLI_BIN_PATH,
} as const;

export interface TelemetryEventRow {
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

export interface BackendHarness {
  readonly database: DevDatabase;
  readonly endpointBase: string;
  clearRows(): Promise<void>;
  readRows(): Promise<TelemetryEventRow[]>;
  awaitRows(expectedCount: number, timeoutMs?: number): Promise<TelemetryEventRow[]>;
  /**
   * Scoped variant of `awaitRows` that polls only rows whose
   * `installationId` matches the supplied id. Use this in tests that
   * seed a unique UUID per case: it eliminates cross-test contamination
   * from a prior test's slow in-flight detached sender (a row arriving
   * *after* the next test's `clearRows()`), which would otherwise
   * inflate the row count past the strict-equality match in the
   * unscoped variant and time out the test with no useful error.
   */
  awaitRowsForInstallation(
    installationId: string,
    expectedCount: number,
    timeoutMs?: number,
  ): Promise<TelemetryEventRow[]>;
  stop(): Promise<void>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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

async function initializeBackendSchema(database: DevDatabase): Promise<void> {
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

function startBackend(port: number, database: DevDatabase): BackendProcess {
  const child = spawn('pnpm', ['exec', 'tsx', 'src/server-node.ts'], {
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
  // Spawn failures (e.g. ENOENT for `pnpm`) emit `error` but not `exit`;
  // record them into the stderr buffer so `waitForBackendReady`'s
  // diagnostic includes them when it times out.
  child.on('error', (err) => stderr.push(`spawn error: ${err.message}\n`));
  return { child, stdout, stderr };
}

async function waitForBackendReady(backend: BackendProcess, endpointBase: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (backend.child.exitCode !== null && backend.child.exitCode !== undefined) {
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
    `telemetry backend did not become ready\n${backend.stdout.join('')}\n${backend.stderr.join('')}`,
  );
}

async function stopBackend(backend: BackendProcess): Promise<void> {
  if (backend.child.exitCode !== null) {
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
      backend.child.kill('SIGKILL');
      finish();
    }, 5000);
    backend.child.once('exit', finish);
    backend.child.kill('SIGTERM');
  });
}

/**
 * Spin up the backend lifecycle and return handles for assertion + teardown.
 * Caller owns the returned harness and must `await harness.stop()` (typically
 * inside `afterAll`) before the database handle is closed.
 */
export async function startBackendHarness(): Promise<BackendHarness> {
  const database = await createDevDatabase();
  await initializeBackendSchema(database);
  const port = await freePort();
  const endpointBase = `http://127.0.0.1:${port}`;
  const backend = startBackend(port, database);
  await waitForBackendReady(backend, endpointBase);

  let stopped = false;

  const clearRows = (): Promise<void> =>
    withClient(database.connectionString, async (client) => {
      await client.query('delete from telemetry_event');
    });

  const readRows = (): Promise<TelemetryEventRow[]> =>
    withClient(database.connectionString, async (client) => {
      const { rows } = await client.query<TelemetryEventRow>(
        'select "installationId", version, command, flags, "runtimeName", "runtimeVersion", os, arch, "packageManager", "databaseTarget", "tsVersion", agent, extensions from telemetry_event order by id asc',
      );
      return rows;
    });

  const readRowsForInstallation = (installationId: string): Promise<TelemetryEventRow[]> =>
    withClient(database.connectionString, async (client) => {
      const { rows } = await client.query<TelemetryEventRow>(
        'select "installationId", version, command, flags, "runtimeName", "runtimeVersion", os, arch, "packageManager", "databaseTarget", "tsVersion", agent, extensions from telemetry_event where "installationId" = $1 order by id asc',
        [installationId],
      );
      return rows;
    });

  // Default exceeds vitest's 5s test timeout so a contamination-driven
  // overshoot in the unscoped variant surfaces as the harness's own
  // diagnostic ("expected N rows, found M") rather than vitest's
  // opaque generic test-timeout. Tests that need an even longer fuse
  // pass an explicit `timeoutMs` and pair it with `{ timeout: … }` on
  // the `it(...)` declaration.
  const awaitRows = async (
    expectedCount: number,
    timeoutMs = 8000,
  ): Promise<TelemetryEventRow[]> => {
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
  };

  const awaitRowsForInstallation = async (
    installationId: string,
    expectedCount: number,
    timeoutMs = 8000,
  ): Promise<TelemetryEventRow[]> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const rows = await readRowsForInstallation(installationId);
      if (rows.length === expectedCount) {
        return rows;
      }
      await sleep(25);
    }
    const rows = await readRowsForInstallation(installationId);
    throw new Error(
      `expected ${expectedCount} telemetry row(s) for installationId=${installationId}, found ${rows.length}`,
    );
  };

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await stopBackend(backend);
  };

  return {
    database,
    endpointBase,
    clearRows,
    readRows,
    awaitRows,
    awaitRowsForInstallation,
    stop,
  };
}
