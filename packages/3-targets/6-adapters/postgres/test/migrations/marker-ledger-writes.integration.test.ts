import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';
import {
  createDriver,
  createTestDatabase,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

const adapter: SqlControlAdapter<'postgres'> = new PostgresControlAdapter();

async function bootstrap(driver: PostgresControlDriver): Promise<void> {
  for (const ddl of adapter.bootstrapControlTableQueries()) {
    const lowered = adapter.lower(ddl, { contract: undefined });
    await driver.query(lowered.sql);
  }
}

describe.sequential('PostgresControlAdapter marker/ledger writes (end-to-end)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
    await bootstrap(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  });

  it('initMarker stamps a readable marker row', { timeout: testTimeout }, async () => {
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'sha256:core',
      profileHash: 'sha256:prof',
      invariants: ['inv-a', 'inv-b'],
    });

    const marker = await adapter.readMarker(driver!, 'app');
    expect(marker).not.toBeNull();
    expect(marker!.storageHash).toBe('sha256:core');
    expect(marker!.profileHash).toBe('sha256:prof');
    expect(marker!.invariants).toEqual(['inv-a', 'inv-b']);
    expect(marker!.updatedAt).toBeInstanceOf(Date);
    expect(marker!.contractJson).toBeNull();
  });

  it('initMarker is idempotent — re-stamping overwrites in place', {
    timeout: testTimeout,
  }, async () => {
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'sha256:core',
      profileHash: 'sha256:prof',
    });
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'sha256:core2',
      profileHash: 'sha256:prof2',
      invariants: ['inv-x'],
    });

    const all = await adapter.readAllMarkers(driver!);
    expect(all.size).toBe(1);
    const marker = all.get('app')!;
    expect(marker.storageHash).toBe('sha256:core2');
    expect(marker.invariants).toEqual(['inv-x']);
  });

  it('updateMarker advances on a matching expectedFrom and writes invariants', {
    timeout: testTimeout,
  }, async () => {
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'sha256:core',
      profileHash: 'sha256:prof',
    });

    const matched = await adapter.updateMarker(driver!, 'app', 'sha256:core', {
      storageHash: 'sha256:next',
      profileHash: 'sha256:prof2',
      invariants: ['inv-1'],
    });

    expect(matched).toBe(true);
    const marker = await adapter.readMarker(driver!, 'app');
    expect(marker!.storageHash).toBe('sha256:next');
    expect(marker!.invariants).toEqual(['inv-1']);
  });

  it('updateMarker returns false (no swap) when expectedFrom does not match', {
    timeout: testTimeout,
  }, async () => {
    await adapter.initMarker(driver!, 'app', {
      storageHash: 'sha256:core',
      profileHash: 'sha256:prof',
    });

    const matched = await adapter.updateMarker(driver!, 'app', 'sha256:stale', {
      storageHash: 'sha256:next',
      profileHash: 'sha256:prof2',
    });

    expect(matched).toBe(false);
    const marker = await adapter.readMarker(driver!, 'app');
    expect(marker!.storageHash).toBe('sha256:core');
  });

  it('writeLedgerEntry appends a readable ledger row', { timeout: testTimeout }, async () => {
    await adapter.writeLedgerEntry(driver!, 'app', {
      edgeId: 'edge-1',
      from: 'sha256:from',
      to: 'sha256:to',
      migrationName: '001_init',
      migrationHash: 'sha256:mig',
      operations: [{ id: 'op-1' }, { id: 'op-2' }],
    });

    const ledger = await adapter.readLedger(driver!, 'app');
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.migrationName).toBe('001_init');
    expect(ledger[0]!.migrationHash).toBe('sha256:mig');
    expect(ledger[0]!.from).toBe('sha256:from');
    expect(ledger[0]!.to).toBe('sha256:to');
    expect(ledger[0]!.operationCount).toBe(2);
  });
});
