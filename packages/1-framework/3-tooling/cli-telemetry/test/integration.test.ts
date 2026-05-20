import { fork } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { timeouts } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_MARKERS } from '../src/detect-agent';
import type { ParentToSenderPayload } from '../src/payload';
import { type BackendHarness, HARNESS_PATHS, startBackendHarness } from './backend-harness';

const SENDER_PATH = HARNESS_PATHS.SENDER_PATH;

let harness: BackendHarness;
let projectDir: string;

beforeAll(async () => {
  harness = await startBackendHarness();
  projectDir = mkdtempSync(join(tmpdir(), 'cli-telemetry-int-project-'));
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'fixture', devDependencies: { typescript: '^5.9.3' } }),
  );
}, timeouts.spinUpPpgDev);

beforeEach(async () => {
  await harness.clearRows();
});

afterAll(async () => {
  await harness?.stop();
  if (projectDir !== undefined) {
    rmSync(projectDir, { recursive: true, force: true });
  }
  if (harness?.database !== undefined) {
    await harness.database.close();
  }
}, timeouts.spinUpPpgDev);

function buildPayload(overrides: Partial<ParentToSenderPayload> = {}): ParentToSenderPayload {
  return {
    installationId: '00000000-0000-4000-8000-000000000001',
    version: '0.9.0',
    command: 'migration new',
    flags: ['name', 'dry-run'],
    databaseTarget: 'postgres',
    extensions: ['pgvector', 'paradedb'],
    projectRoot: projectDir,
    endpoint: `${harness.endpointBase}/events`,
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

describe('cli-telemetry end-to-end via telemetry backend', () => {
  it('forks the sender, the child POSTs the event, and the backend stores the wire shape', async () => {
    await spawnSenderDirect(buildPayload());
    const [row] = await harness.awaitRows(1);

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
    const [row] = await harness.awaitRows(1);

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
    const [row] = await harness.awaitRows(1);
    expect(row?.extensions).toEqual(['pgvector', 'paradedb', 'myorg-custom-ext']);
  });

  it('populates the agent field from the child env', async () => {
    await spawnSenderDirect(buildPayload(), { ...process.env, CLAUDECODE: '1' });
    const [row] = await harness.awaitRows(1);
    expect(row?.agent).toBe('Claude Code');
  });

  it('populates the agent field for Gemini CLI sessions', async () => {
    await spawnSenderDirect(buildPayload(), { ...process.env, GEMINI_CLI: '1' });
    const [row] = await harness.awaitRows(1);
    expect(row?.agent).toBe('Gemini CLI');
  });

  it('passes null agent when no marker env var is set', async () => {
    await spawnSenderDirect(buildPayload(), envWithoutAgentMarkers());
    const [row] = await harness.awaitRows(1);
    expect(row?.agent).toBeNull();
  });

  it('produces a backend-accepted row containing the required field set', async () => {
    await spawnSenderDirect(buildPayload());
    const [row] = await harness.awaitRows(1);
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
