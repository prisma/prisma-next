import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { buildDomainPlaneFromFlat } from '@prisma-next/contract/types';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { formatMigrationDirName, writeMigrationPackage } from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import { join } from 'pathe';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbSignCommand } from '../../src/commands/db-sign';
import { executeMigrationGraphCommand } from '../../src/commands/migration-graph';
import { executeMigrationLogCommand } from '../../src/commands/migration-log';
import { executeRefSetCommand } from '../../src/commands/ref';
import { parseGlobalFlags } from '../../src/utils/global-flags';
import { createTerminalUI } from '../../src/utils/terminal-ui';
import { executeCommand, setupCommandMocks } from '../utils/test-helpers';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  writeRefPaired: vi.fn(),
  readMarker: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  schemaVerify: vi.fn(),
  sign: vi.fn(),
}));

vi.mock('../../src/config-loader', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('@prisma-next/migration-tools/refs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma-next/migration-tools/refs')>();
  return { ...actual, writeRefPaired: mocks.writeRefPaired };
});

vi.mock('../../src/control-api/client', () => ({
  createControlClient: vi.fn(() => ({
    connect: mocks.connect,
    readMarker: mocks.readMarker,
    close: mocks.close,
    schemaVerify: mocks.schemaVerify,
    sign: mocks.sign,
  })),
}));

const TARGET = 'postgres';
const TARGET_FAMILY = 'sql';
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

const ADDITIVE_OP: MigrationPlanOperation = {
  id: 'table.users',
  label: 'Create users',
  operationClass: 'additive',
};

const createdDirs: string[] = [];

function baseConfig(contractOutput: string) {
  return {
    family: {
      familyId: TARGET_FAMILY,
      create: vi.fn().mockReturnValue({
        deserializeContract: (json: unknown) => json,
      }),
    },
    target: {
      id: TARGET,
      familyId: TARGET_FAMILY,
      targetId: TARGET,
      kind: 'target',
      migrations: {},
    },
    adapter: { kind: 'adapter', familyId: TARGET_FAMILY, targetId: TARGET },
    driver: { kind: 'driver' },
    db: { connection: 'postgres://localhost/read-commands-golden' },
    contract: { output: contractOutput },
    migrations: { dir: 'migrations' },
  };
}

async function writeContract(cwd: string, storageHash: string): Promise<string> {
  const contractPath = join(cwd, 'contract.json');
  await writeFile(
    contractPath,
    JSON.stringify({
      storage: { storageHash },
      schemaVersion: '1.0.0',
      target: TARGET,
      targetFamily: TARGET_FAMILY,
    }),
  );
  return contractPath;
}

async function writeLinearMigrations(
  migrationsRoot: string,
): Promise<{ dirInit: string; dirNext: string }> {
  const appDir = join(migrationsRoot, 'app');
  await mkdir(appDir, { recursive: true });

  const writePkg = async (
    slug: string,
    from: string | null,
    to: string,
    date: Date,
  ): Promise<string> => {
    const dirName = formatMigrationDirName(date, slug);
    const metadataBase: Omit<MigrationMetadata, 'migrationHash'> = {
      from,
      to,
      providedInvariants: [],
      createdAt: date.toISOString(),
    };
    const metadata: MigrationMetadata = {
      ...metadataBase,
      migrationHash: computeMigrationHash(metadataBase, [ADDITIVE_OP]),
    };
    await writeMigrationPackage(join(appDir, dirName), metadata, [ADDITIVE_OP]);
    return dirName;
  };

  const dirInit = await writePkg('init', null, HASH_A, new Date('2026-01-01T10:00:00Z'));
  const dirNext = await writePkg('add_users', HASH_A, HASH_B, new Date('2026-01-02T10:00:00Z'));
  return { dirInit, dirNext };
}

async function writeEndContract(packageDir: string, storageHash: string): Promise<void> {
  const contract = {
    schemaVersion: '1',
    targetFamily: TARGET_FAMILY,
    target: TARGET,
    profileHash: `sha256:${'p'.repeat(64)}`,
    storage: { storageHash },
    domain: buildDomainPlaneFromFlat({ models: {} }),
    roots: {},
  };
  await writeFile(join(packageDir, 'end-contract.json'), `${JSON.stringify(contract, null, 2)}\n`);
  await writeFile(join(packageDir, 'end-contract.d.ts'), 'export type Contract = unknown;\n');
}

function migrationGraphJson(result: {
  graph: {
    nodes: ReadonlySet<string>;
    migrationByHash: ReadonlyMap<
      string,
      { dirName: string; from: string; to: string; migrationHash: string }
    >;
  };
  summary: string;
}): string {
  const nodes = [...result.graph.nodes];
  const edges = [...result.graph.migrationByHash.values()].map((e) => ({
    dirName: e.dirName,
    from: e.from,
    to: e.to,
    migrationHash: e.migrationHash,
  }));
  return JSON.stringify({ ok: true, nodes, edges, summary: result.summary }, null, 2);
}

function migrationLogJson(result: {
  ok: true;
  markerHash: string | null;
  applied: readonly {
    dirName: string;
    from: string;
    to: string;
    migrationHash: string;
    operationCount: number;
    createdAt: string;
  }[];
  summary: string;
}): string {
  return JSON.stringify(result, null, 2);
}

describe('read commands --json golden', () => {
  afterAll(() => {
    vi.doUnmock('../../src/config-loader');
    vi.doUnmock('@prisma-next/migration-tools/refs');
    vi.doUnmock('../../src/control-api/client');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.writeRefPaired.mockResolvedValue(undefined);
    mocks.schemaVerify.mockResolvedValue({ ok: true, summary: 'Schema matches contract' });
    mocks.sign.mockResolvedValue({
      ok: true,
      summary: 'Database signed',
      contract: { storageHash: HASH_B },
      target: { expected: TARGET },
      marker: { created: true, updated: false },
      timings: { total: 0 },
    });
  });

  afterEach(async () => {
    await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    createdDirs.length = 0;
    vi.restoreAllMocks();
  });

  it('pins migration graph --json for a linear app chain', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'read-cmd-graph-json-'));
    createdDirs.push(cwd);
    const contractPath = await writeContract(cwd, HASH_B);
    const { dirInit, dirNext } = await writeLinearMigrations(join(cwd, 'migrations'));
    mocks.loadConfig.mockResolvedValue(baseConfig(contractPath));

    const flags = parseGlobalFlags({ json: true, quiet: true });
    const ui = createTerminalUI(flags);
    const result = await executeMigrationGraphCommand({ config: contractPath }, flags, ui);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const json = migrationGraphJson(result.value);
    expect(json).toBe(
      [
        '{',
        '  "ok": true,',
        '  "nodes": [',
        `    "${EMPTY_CONTRACT_HASH}",`,
        `    "${HASH_A}",`,
        `    "${HASH_B}"`,
        '  ],',
        '  "edges": [',
        '    {',
        `      "dirName": "${dirInit}",`,
        `      "from": "${EMPTY_CONTRACT_HASH}",`,
        `      "to": "${HASH_A}",`,
        '      "migrationHash": "sha256:d5c8739bfe8617fa82603875980b18d7dee1e02637499fd451ec7f1a7087e920"',
        '    },',
        '    {',
        `      "dirName": "${dirNext}",`,
        `      "from": "${HASH_A}",`,
        `      "to": "${HASH_B}",`,
        '      "migrationHash": "sha256:ca2593661d91c77720887ec8ff9ff6de7a7009df17757b7a5952fde8ceae9747"',
        '    }',
        '  ],',
        '  "summary": "3 node(s), 2 edge(s)"',
        '}',
      ].join('\n'),
    );
  });

  it('pins migration log --json for marker at chain tip', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'read-cmd-log-json-'));
    createdDirs.push(cwd);
    const contractPath = await writeContract(cwd, HASH_B);
    const { dirInit, dirNext } = await writeLinearMigrations(join(cwd, 'migrations'));
    mocks.loadConfig.mockResolvedValue(baseConfig(contractPath));
    mocks.readMarker.mockResolvedValue({ storageHash: HASH_B });

    const flags = parseGlobalFlags({ json: true, quiet: true });
    const ui = createTerminalUI(flags);
    const result = await executeMigrationLogCommand(
      { config: contractPath, db: 'postgres://localhost/read-commands-golden' },
      flags,
      ui,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const json = migrationLogJson(result.value);
    const parsed = JSON.parse(json) as {
      applied: Array<{ dirName: string; migrationHash: string }>;
    };
    expect(parsed.applied).toHaveLength(2);
    expect(parsed.applied.map((e) => e.dirName).sort()).toEqual([dirInit, dirNext].sort());
    expect(json).toContain('"markerHash": "' + HASH_B + '"');
    expect(json).toContain('"summary": "2 migration(s) applied"');
    expect(json).toContain('"ok": true');
  });

  it('pins ref set --json when resolving a migration dir name', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'read-cmd-ref-json-'));
    createdDirs.push(cwd);
    const contractPath = await writeContract(cwd, HASH_B);
    const { dirNext } = await writeLinearMigrations(join(cwd, 'migrations'));
    const packageDir = join(cwd, 'migrations', 'app', dirNext);
    await writeEndContract(packageDir, HASH_B);
    mocks.loadConfig.mockResolvedValue(baseConfig(contractPath));

    const prev = process.cwd();
    process.chdir(cwd);
    let result: Awaited<ReturnType<typeof executeRefSetCommand>>;
    try {
      result = await executeRefSetCommand('staging', dirNext, { config: contractPath });
    } finally {
      process.chdir(prev);
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const json = JSON.stringify(result.value, null, 2);
    expect(json).toBe(
      `{\n  "ok": true,\n  "ref": "staging",\n  "hash": "${HASH_B}",\n  "invariants": []\n}`,
    );
  });

  it('pins db sign --json when resolving contract from a migration dir', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'read-cmd-dbsign-json-'));
    createdDirs.push(cwd);
    const contractPath = await writeContract(cwd, HASH_B);
    const { dirNext } = await writeLinearMigrations(join(cwd, 'migrations'));
    const packageDir = join(cwd, 'migrations', 'app', dirNext);
    await writeEndContract(packageDir, HASH_B);
    mocks.loadConfig.mockResolvedValue(baseConfig(contractPath));

    const { consoleOutput, cleanup } = setupCommandMocks({ isTTY: false });
    const signCmd = createDbSignCommand();
    const prev = process.cwd();
    process.chdir(cwd);
    let exitCode: number;
    try {
      exitCode = await executeCommand(signCmd, [
        dirNext,
        '--json',
        '--db',
        'postgres://localhost/read-commands-golden',
        '--config',
        contractPath,
      ]);
    } finally {
      process.chdir(prev);
      cleanup();
    }
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(consoleOutput.join('\n')) as {
      ok: boolean;
      summary: string;
      contract: { storageHash: string };
      target: { expected: string };
      marker: { created: boolean; updated: boolean };
      timings: { total: number };
    };
    expect(parsed.timings.total).toBeGreaterThanOrEqual(0);
    const { timings: _timings, ...stable } = parsed;
    expect(JSON.stringify(stable, null, 2)).toBe(
      [
        '{',
        '  "ok": true,',
        '  "summary": "Database signed",',
        '  "contract": {',
        `    "storageHash": "${HASH_B}"`,
        '  },',
        '  "target": {',
        `    "expected": "${TARGET}"`,
        '  },',
        '  "marker": {',
        '    "created": true,',
        '    "updated": false',
        '  }',
        '}',
      ].join('\n'),
    );
  });
});
