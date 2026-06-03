import type { LedgerEntryRecord } from '@prisma-next/contract/types';
import { describe, expect, it, vi } from 'vitest';
import { executeMigrationLogCommand } from '../../src/commands/migration-log';
import { parseGlobalFlags } from '../../src/utils/global-flags';
import { createTerminalUI } from '../../src/utils/terminal-ui';

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
