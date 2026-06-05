import type { LedgerEntryRecord } from '@prisma-next/contract/types';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMigrationLogCommand,
  executeMigrationLogCommand,
} from '../../src/commands/migration-log';
import { parseGlobalFlags } from '../../src/utils/global-flags';
import { createTerminalUI } from '../../src/utils/terminal-ui';
import {
  executeCommand,
  parseJsonObjectFromCliCapture,
  setupCommandMocks,
} from '../utils/test-helpers';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  readLedger: vi.fn(),
}));

vi.mock('../../src/config-loader', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../../src/control-api/client', () => ({
  createControlClient: vi.fn(() => ({
    connect: mocks.connect,
    readLedger: mocks.readLedger,
    close: mocks.close,
  })),
}));

afterAll(() => {
  // Repo-wide vitest runs with `isolate: false`, so the `vi.mock` leaks
  // into the next file in the same worker; unmock to restore it.
  vi.doUnmock('../../src/config-loader');
  vi.doUnmock('../../src/control-api/client');
  vi.resetModules();
});

const baseConfig = {
  family: { familyId: 'sql', create: vi.fn() },
  target: { id: 'postgres', familyId: 'sql', targetId: 'postgres', kind: 'target', migrations: {} },
  adapter: { kind: 'adapter', familyId: 'sql', targetId: 'postgres' },
  driver: { kind: 'driver' },
  db: { connection: 'postgres://localhost/test' },
  contract: { output: 'contract.json' },
  migrations: { dir: 'migrations' },
};

function ledgerEntry(
  overrides: Partial<LedgerEntryRecord> & Pick<LedgerEntryRecord, 'migrationName'>,
): LedgerEntryRecord {
  return {
    space: 'app',
    migrationHash: 'sha256:mig',
    from: null,
    to: 'sha256:dest',
    appliedAt: new Date('2026-06-01T08:00:00.000Z'),
    operationCount: 3,
    ...overrides,
  };
}

describe('executeMigrationLogCommand', () => {
  it('returns a structured error when no database connection is configured', async () => {
    mocks.loadConfig.mockResolvedValue({
      ...baseConfig,
      db: {},
    });
    const result = await executeMigrationLogCommand(
      { config: 'prisma-next.config.ts' },
      parseGlobalFlags({}),
      createTerminalUI(parseGlobalFlags({})),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('4005');
    expect(result.failure.meta?.['missingFlags']).toEqual(['--db']);
  });

  it('returns the same missing-DB envelope when only the driver is missing', async () => {
    mocks.loadConfig.mockResolvedValue({
      ...baseConfig,
      driver: undefined,
    });
    const result = await executeMigrationLogCommand(
      { config: 'prisma-next.config.ts', db: 'postgres://localhost/test' },
      parseGlobalFlags({}),
      createTerminalUI(parseGlobalFlags({})),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('4005');
    expect(result.failure.meta?.['missingFlags']).toEqual([]);
  });

  it('returns an empty array when the ledger has no rows', async () => {
    mocks.loadConfig.mockResolvedValue(baseConfig);
    mocks.connect.mockResolvedValue(undefined);
    mocks.readLedger.mockResolvedValue([]);
    mocks.close.mockResolvedValue(undefined);

    const result = await executeMigrationLogCommand(
      { config: 'prisma-next.config.ts', db: 'postgres://localhost/test' },
      parseGlobalFlags({ json: true }),
      createTerminalUI(parseGlobalFlags({ json: true })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it('reads the unscoped ledger', async () => {
    mocks.loadConfig.mockResolvedValue(baseConfig);
    mocks.connect.mockResolvedValue(undefined);
    mocks.readLedger.mockResolvedValue([ledgerEntry({ migrationName: '20260301_init' })]);
    mocks.close.mockResolvedValue(undefined);

    const result = await executeMigrationLogCommand(
      { config: 'prisma-next.config.ts', db: 'postgres://localhost/test' },
      parseGlobalFlags({ json: true }),
      createTerminalUI(parseGlobalFlags({ json: true })),
    );
    expect(mocks.readLedger).toHaveBeenCalledWith();
    expect(result.ok).toBe(true);
  });

  it('preserves rollback and re-apply rows as repeated uniform entries', async () => {
    mocks.loadConfig.mockResolvedValue(baseConfig);
    mocks.connect.mockResolvedValue(undefined);
    mocks.readLedger.mockResolvedValue([
      ledgerEntry({
        migrationName: '20260303_add',
        from: null,
        to: 'sha256:a',
        appliedAt: new Date('2026-06-01T08:00:00.000Z'),
      }),
      ledgerEntry({
        migrationName: '20260303_add',
        from: 'sha256:a',
        to: 'sha256:b',
        appliedAt: new Date('2026-06-02T08:00:00.000Z'),
      }),
      ledgerEntry({
        migrationName: '20260303_add',
        from: 'sha256:b',
        to: 'sha256:a',
        appliedAt: new Date('2026-06-03T08:00:00.000Z'),
      }),
    ]);
    mocks.close.mockResolvedValue(undefined);

    const result = await executeMigrationLogCommand(
      { config: 'prisma-next.config.ts', db: 'postgres://localhost/test' },
      parseGlobalFlags({ json: true }),
      createTerminalUI(parseGlobalFlags({ json: true })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
    expect(result.value.every((row) => row.migrationName === '20260303_add')).toBe(true);
  });
});

describe('migration log --json envelope', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('emits { ok: true, entries: [...] } for a populated ledger', async () => {
    mocks.loadConfig.mockResolvedValue(baseConfig);
    mocks.connect.mockResolvedValue(undefined);
    mocks.readLedger.mockResolvedValue([ledgerEntry({ migrationName: '20260301_init' })]);
    mocks.close.mockResolvedValue(undefined);

    const { consoleOutput, cleanup } = setupCommandMocks();
    try {
      await executeCommand(createMigrationLogCommand(), [
        '--json',
        '--db',
        'postgres://localhost/test',
      ]);
    } finally {
      cleanup();
    }

    const envelope = parseJsonObjectFromCliCapture(consoleOutput) as {
      ok: boolean;
      entries: ReadonlyArray<{ migrationName: string }>;
    };
    expect(envelope.ok).toBe(true);
    expect(Array.isArray(envelope.entries)).toBe(true);
    expect(envelope.entries).toHaveLength(1);
    expect(envelope.entries[0]?.migrationName).toBe('20260301_init');
  });

  it('emits { ok: true, entries: [] } for an empty ledger', async () => {
    mocks.loadConfig.mockResolvedValue(baseConfig);
    mocks.connect.mockResolvedValue(undefined);
    mocks.readLedger.mockResolvedValue([]);
    mocks.close.mockResolvedValue(undefined);

    const { consoleOutput, cleanup } = setupCommandMocks();
    try {
      await executeCommand(createMigrationLogCommand(), [
        '--json',
        '--db',
        'postgres://localhost/test',
      ]);
    } finally {
      cleanup();
    }

    const envelope = parseJsonObjectFromCliCapture(consoleOutput) as {
      ok: boolean;
      entries: readonly unknown[];
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.entries).toEqual([]);
  });
});
