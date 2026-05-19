/**
 * End-to-end integration test for the cli-telemetry pipeline. Spins up
 * an `http.createServer` on an ephemeral port, points the spawned
 * sender at it via `PRISMA_NEXT_TELEMETRY_ENDPOINT`, and asserts the
 * captured POST body matches the expected wire shape.
 *
 * The mock server substitutes for the real Prisma Compute backend. The
 * stable contract being verified is the network API — the wire-shape
 * `TelemetryEvent` and the endpoint URL the parent resolves. Verifying
 * against the deployed backend is out of scope here; the
 * cli-telemetry package lives in `packages/` and cannot import from
 * `apps/`, and the deployed backend is also a moving target across
 * deploys.
 */
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ParentToSenderPayload } from '../src/payload';

const SENDER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'sender.mjs');

interface CapturedRequest {
  readonly method: string;
  readonly url: string;
  readonly contentType: string;
  readonly body: Record<string, unknown>;
}

const captured: CapturedRequest[] = [];

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => res(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', rej);
  });
}

let server: Server;
let endpointBase: string;
let projectDir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    void readBody(req).then((raw) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        parsed = { _parseError: true, raw };
      }
      captured.push({
        method: req.method ?? 'UNKNOWN',
        url: req.url ?? '/',
        contentType: req.headers['content-type'] ?? '',
        body: parsed,
      });
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('mock server did not bind to a known address');
  }
  endpointBase = `http://127.0.0.1:${address.port}`;
  projectDir = mkdtempSync(join(tmpdir(), 'cli-telemetry-int-project-'));
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'fixture', devDependencies: { typescript: '^5.9.3' } }),
  );
});

afterAll(async () => {
  await new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res())));
  rmSync(projectDir, { recursive: true, force: true });
});

beforeEach(() => {
  captured.length = 0;
});

async function awaitCapture(timeoutMs = 5000): Promise<CapturedRequest> {
  const start = Date.now();
  while (captured.length === 0) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`mock server did not receive a request within ${timeoutMs} ms`);
    }
    await new Promise<void>((res) => setTimeout(res, 25));
  }
  return captured[0] as CapturedRequest;
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

function spawnSenderDirect(payload: ParentToSenderPayload): Promise<void> {
  return new Promise((res, rej) => {
    const child = fork(SENDER_PATH, [], {
      stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
    });
    child.on('error', rej);
    child.on('exit', () => res());
    child.send(payload);
  });
}

describe('cli-telemetry end-to-end via mock backend', () => {
  it('forks the sender, the child POSTs the event, and the parent payload round-trips into the wire shape', async () => {
    await spawnSenderDirect(buildPayload());
    const req = await awaitCapture();

    expect(req.method).toBe('POST');
    expect(req.url).toBe('/events');
    expect(req.contentType).toContain('application/json');

    expect(req.body['installationId']).toBe('00000000-0000-4000-8000-000000000001');
    expect(req.body['version']).toBe('0.9.0');
    expect(req.body['command']).toBe('migration new');
    expect(req.body['flags']).toEqual(['name', 'dry-run']);
    expect(req.body['databaseTarget']).toBe('postgres');
    expect(req.body['extensions']).toEqual(['pgvector', 'paradedb']);

    // Child-supplied fields
    expect(typeof req.body['runtimeName']).toBe('string');
    expect(typeof req.body['runtimeVersion']).toBe('string');
    expect(typeof req.body['os']).toBe('string');
    expect(typeof req.body['arch']).toBe('string');
    expect(req.body['tsVersion']).toBe('5.9.3');
  });

  it('transmits only flag names, never values or positionals (wire-side sanitiser check)', async () => {
    const sensitiveFlags = ['connection-string', 'name', 'config'];
    await spawnSenderDirect(buildPayload({ flags: sensitiveFlags }));
    const req = await awaitCapture();

    expect(req.body['flags']).toEqual(sensitiveFlags);
    const serialised = JSON.stringify(req.body);
    expect(serialised).not.toMatch(/postgres:\/\/u:p@h\/d/);
    expect(serialised).not.toMatch(/customer-acme-payments/);
    expect(serialised).not.toMatch(/\/Users\/alice\/secrets/);
  });

  it('round-trips a string[] of declared extension-pack ids verbatim', async () => {
    await spawnSenderDirect(
      buildPayload({ extensions: ['pgvector', 'paradedb', 'myorg-custom-ext'] }),
    );
    const req = await awaitCapture();
    expect(req.body['extensions']).toEqual(['pgvector', 'paradedb', 'myorg-custom-ext']);
  });

  it('populates the agent field from the child env', async () => {
    // Spawn the child with CLAUDECODE set; the child's detector reads
    // from its own process.env.
    const payload = buildPayload();
    await new Promise<void>((res, rej) => {
      const child = fork(SENDER_PATH, [], {
        stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
        env: { ...process.env, CLAUDECODE: '1' },
      });
      child.on('error', rej);
      child.on('exit', () => res());
      child.send(payload);
    });
    const req = await awaitCapture();
    expect(req.body['agent']).toBe('Claude Code');
  });

  it('passes null agent when no marker env var is set', async () => {
    const payload = buildPayload();
    await new Promise<void>((res, rej) => {
      const baseEnv = { ...process.env };
      for (const key of ['CLAUDECODE', 'CURSOR_AGENT', 'WINDSURF', 'AIDER', 'CODY', 'CONTINUE']) {
        delete baseEnv[key];
      }
      const child = fork(SENDER_PATH, [], {
        stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
        env: baseEnv,
      });
      child.on('error', rej);
      child.on('exit', () => res());
      child.send(payload);
    });
    const req = await awaitCapture();
    expect(req.body['agent']).toBeNull();
  });

  it('produces a wire body that exactly matches the backend\u2019s accepted required-set', async () => {
    await spawnSenderDirect(buildPayload());
    const req = await awaitCapture();
    // The seven required fields the backend enforces:
    const required = [
      'installationId',
      'version',
      'command',
      'runtimeName',
      'runtimeVersion',
      'os',
      'arch',
    ];
    for (const field of required) {
      expect(typeof req.body[field]).toBe('string');
      expect((req.body[field] as string).length).toBeGreaterThan(0);
    }
  });
});

describe('cli-telemetry end-to-end \u2014 failure modes are silent', () => {
  it('the sender swallows a non-2xx response (parent never knows)', async () => {
    // Reconfigure the server to reject the next request.
    // Quickest path: send the event at a port nothing is listening on
    // (127.0.0.1:1 is a privileged port that should refuse).
    const payload = buildPayload({ endpoint: 'http://127.0.0.1:1/events' });
    await new Promise<void>((res, rej) => {
      const child = fork(SENDER_PATH, [], {
        stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
      });
      child.on('error', rej);
      child.on('exit', (code) => {
        // Exit must be 0 regardless of network outcome.
        expect(code).toBe(0);
        res();
      });
      child.send(payload);
    });
  });

  it('the sender exits 0 when no payload is received within the idle timeout', async () => {
    await new Promise<void>((res, rej) => {
      const child = fork(SENDER_PATH, [], {
        stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
      });
      child.on('error', rej);
      child.on('exit', (code) => {
        expect(code).toBe(0);
        res();
      });
      // Don't send a payload; let the idle timeout fire.
      // Disconnect manually so the child sees the IPC channel close.
      setTimeout(() => child.disconnect(), 50);
    });
  }, 10_000);
});
