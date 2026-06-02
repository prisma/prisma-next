import type { LedgerEntryRecord } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import {
  type AggregateMigrationEdgeRef,
  buildSynthMigrationEdge,
} from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { PostgresPlanTargetDetails } from '@prisma-next/target-postgres/planner-target-details';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';
import {
  contract,
  createDriver,
  createLedgerTestPlan,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  LEDGER_TEST_SPACE_ID,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

interface LedgerRow {
  readonly space: string;
  readonly migration_name: string;
  readonly migration_hash: string;
  readonly origin_core_hash: string | null;
  readonly destination_core_hash: string;
  readonly contract_json_before: unknown;
  readonly contract_json_after: unknown;
  readonly operations: unknown;
}

const ledgerAdapter = new PostgresControlAdapter();

type ExpectedLedgerEntry = Omit<LedgerEntryRecord, 'appliedAt'>;

function expectReadLedger(
  entries: readonly LedgerEntryRecord[],
  expected: readonly ExpectedLedgerEntry[],
): void {
  expect(entries).toHaveLength(expected.length);
  for (const entry of entries) {
    expect(entry.appliedAt).toBeInstanceOf(Date);
  }
  expect(entries.map(({ appliedAt: _appliedAt, ...rest }) => rest)).toEqual(expected);
}

async function readLedgerRows(driver: PostgresControlDriver): Promise<LedgerRow[]> {
  const result = await driver.query<LedgerRow>(
    `select space, migration_name, migration_hash, origin_core_hash, destination_core_hash,
      contract_json_before, contract_json_after, operations
     from prisma_contract.ledger order by id`,
  );
  return result.rows;
}

describe.sequential('PostgresMigrationRunner - per-edge ledger', () => {
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
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  });

  it('readLedger returns an empty array when the ledger table does not exist', {
    timeout: testTimeout,
  }, async () => {
    const freshDriver = await createDriver(database.connectionString);
    const ledger = await ledgerAdapter.readLedger(freshDriver, LEDGER_TEST_SPACE_ID);
    expect(ledger).toEqual([]);
    await freshDriver.close();
  });

  it('writes one ledger row for a single-edge apply with space, name, hash, from/to, and that edge ops', {
    timeout: testTimeout,
  }, async () => {
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const destHash = contract.storage.storageHash;
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'sha256:mig-single',
        dirName: '001_single',
        from: EMPTY_CONTRACT_HASH,
        to: destHash,
        operationCount: 1,
      },
    ];
    const plan = createLedgerTestPlan<PostgresPlanTargetDetails>({
      destinationHash: destHash,
      operations: [
        {
          id: 'edge.single.op',
          label: 'single edge op',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'user' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
      ],
      migrationEdges: edges,
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: edges,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));

    const rows = await readLedgerRows(driver!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      space: LEDGER_TEST_SPACE_ID,
      migration_name: '001_single',
      migration_hash: 'sha256:mig-single',
      origin_core_hash: EMPTY_CONTRACT_HASH,
      destination_core_hash: destHash,
    });
    const ops = rows[0]!.operations as Array<{ id: string }>;
    expect(ops).toHaveLength(1);
    expect(ops[0]?.id).toBe('edge.single.op');
    expect(rows[0]!.contract_json_before).toBeNull();
    expect(rows[0]!.contract_json_after).toMatchObject({
      storage: { storageHash: destHash },
    });

    const ledger = await ledgerAdapter.readLedger(driver!, LEDGER_TEST_SPACE_ID);
    expectReadLedger(ledger, [
      {
        space: LEDGER_TEST_SPACE_ID,
        migrationName: '001_single',
        migrationHash: 'sha256:mig-single',
        from: null,
        to: destHash,
        operationCount: 1,
      },
    ]);
  });

  it('writes N ledger rows in walk order for multi-edge apply with ops and contract_json on endpoints only', {
    timeout: testTimeout,
  }, async () => {
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const hashA = 'sha256:ledger-mid-a';
    const hashB = 'sha256:ledger-mid-b';
    const destHash = contract.storage.storageHash;
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'sha256:mig-a',
        dirName: '001_a',
        from: EMPTY_CONTRACT_HASH,
        to: hashA,
        operationCount: 1,
      },
      {
        migrationHash: 'sha256:mig-b',
        dirName: '002_b',
        from: hashA,
        to: hashB,
        operationCount: 2,
      },
      {
        migrationHash: 'sha256:mig-c',
        dirName: '003_c',
        from: hashB,
        to: destHash,
        operationCount: 1,
      },
    ];
    const plan = createLedgerTestPlan<PostgresPlanTargetDetails>({
      destinationHash: destHash,
      operations: [
        {
          id: 'edge.a',
          label: 'a',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'a' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
        {
          id: 'edge.b1',
          label: 'b1',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'b1' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
        {
          id: 'edge.b2',
          label: 'b2',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'b2' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
        {
          id: 'edge.c',
          label: 'c',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'c' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
      ],
      migrationEdges: edges,
    });

    const result = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: edges,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));

    const rows = await readLedgerRows(driver!);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.migration_name)).toEqual(['001_a', '002_b', '003_c']);
    expect(rows.map((r) => r.space)).toEqual([
      LEDGER_TEST_SPACE_ID,
      LEDGER_TEST_SPACE_ID,
      LEDGER_TEST_SPACE_ID,
    ]);
    expect(rows[0]).toMatchObject({
      origin_core_hash: EMPTY_CONTRACT_HASH,
      destination_core_hash: hashA,
    });
    expect(rows[1]).toMatchObject({
      origin_core_hash: hashA,
      destination_core_hash: hashB,
    });
    expect(rows[2]).toMatchObject({
      origin_core_hash: hashB,
      destination_core_hash: destHash,
    });

    const opCounts = rows.map((r) => (r.operations as unknown[]).length);
    expect(opCounts).toEqual([1, 2, 1]);
    const opIds = rows.flatMap((r) => (r.operations as Array<{ id: string }>).map((o) => o.id));
    expect(opIds).toEqual(['edge.a', 'edge.b1', 'edge.b2', 'edge.c']);

    expect(rows[0]!.contract_json_before).toBeNull();
    expect(rows[0]!.contract_json_after).toBeNull();
    expect(rows[1]!.contract_json_before).toBeNull();
    expect(rows[1]!.contract_json_after).toBeNull();
    expect(rows[2]!.contract_json_before).toBeNull();
    expect(rows[2]!.contract_json_after).toMatchObject({
      storage: { storageHash: destHash },
    });

    const ledger = await ledgerAdapter.readLedger(driver!, LEDGER_TEST_SPACE_ID);
    expectReadLedger(ledger, [
      {
        space: LEDGER_TEST_SPACE_ID,
        migrationName: '001_a',
        migrationHash: 'sha256:mig-a',
        from: null,
        to: hashA,
        operationCount: 1,
      },
      {
        space: LEDGER_TEST_SPACE_ID,
        migrationName: '002_b',
        migrationHash: 'sha256:mig-b',
        from: hashA,
        to: hashB,
        operationCount: 2,
      },
      {
        space: LEDGER_TEST_SPACE_ID,
        migrationName: '003_c',
        migrationHash: 'sha256:mig-c',
        from: hashB,
        to: destHash,
        operationCount: 1,
      },
    ]);
  });

  it('writes one synthesised ledger row with space for synth apply with a single synth edge', {
    timeout: testTimeout,
  }, async () => {
    const planner = postgresTargetDescriptor.createPlanner(familyInstance);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const planResult = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
    });
    if (planResult.kind !== 'success') throw new Error('expected planner success');

    const synthEdges = [
      buildSynthMigrationEdge({
        currentMarkerStorageHash: null,
        destinationStorageHash: contract.storage.storageHash,
        operationCount: planResult.plan.operations.length,
      }),
    ];

    const executeResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          plan: planResult.plan,
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: synthEdges,
        },
      ],
    });
    if (!executeResult.ok) throw new Error(formatRunnerFailure(executeResult.failure));

    const rows = await readLedgerRows(driver!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      space: APP_SPACE_ID,
      migration_name: '',
      migration_hash: contract.storage.storageHash,
      destination_core_hash: contract.storage.storageHash,
    });

    const ledger = await ledgerAdapter.readLedger(driver!, APP_SPACE_ID);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      space: APP_SPACE_ID,
      migrationName: '',
      migrationHash: contract.storage.storageHash,
      from: null,
      to: contract.storage.storageHash,
    });
    const storedSynthOps = rows[0]!.operations;
    expect(ledger[0]!.operationCount).toBe(
      Array.isArray(storedSynthOps) ? storedSynthOps.length : 0,
    );
  });
});
