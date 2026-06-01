import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type { AggregateMigrationEdgeRef } from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contract,
  createLedgerTestPlan,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  LEDGER_TEST_SPACE_ID,
  sqliteTargetDescriptor,
  type TestDatabase,
} from './fixtures/runner-fixtures';

interface LedgerRow {
  readonly space: string;
  readonly migration_name: string;
  readonly migration_hash: string;
  readonly origin_core_hash: string | null;
  readonly destination_core_hash: string;
  readonly contract_json_before: string | null;
  readonly contract_json_after: string | null;
  readonly operations: string;
}

async function readLedgerRows(driver: TestDatabase['driver']): Promise<LedgerRow[]> {
  return (
    await driver.query<LedgerRow>(
      `SELECT space, migration_name, migration_hash, origin_core_hash, destination_core_hash,
        contract_json_before, contract_json_after, operations
       FROM _prisma_ledger ORDER BY id`,
    )
  ).rows;
}

function parseNullableJsonColumn(value: string | null): unknown {
  if (value === null) {
    return null;
  }
  return JSON.parse(value) as unknown;
}

describe('SqliteMigrationRunner - per-edge ledger', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('writes one ledger row for a single-edge apply with space, name, hash, from/to, and that edge ops', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
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
    const plan = createLedgerTestPlan({
      destinationHash: destHash,
      operations: [
        {
          id: 'edge.single.op',
          label: 'single edge op',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'user' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
      ],
      migrationEdges: edges,
    });

    const result = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: edges,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));

    const rows = await readLedgerRows(driver);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      space: LEDGER_TEST_SPACE_ID,
      migration_name: '001_single',
      migration_hash: 'sha256:mig-single',
      origin_core_hash: EMPTY_CONTRACT_HASH,
      destination_core_hash: destHash,
    });
    const ops = JSON.parse(rows[0]!.operations) as Array<{ id: string }>;
    expect(ops).toHaveLength(1);
    expect(ops[0]?.id).toBe('edge.single.op');
    expect(parseNullableJsonColumn(rows[0]!.contract_json_before)).toBeNull();
    expect(parseNullableJsonColumn(rows[0]!.contract_json_after)).toMatchObject({
      storage: { storageHash: destHash },
    });
  });

  it('writes N ledger rows in walk order for multi-edge apply with ops and contract_json on endpoints only', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
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
    const plan = createLedgerTestPlan({
      destinationHash: destHash,
      operations: [
        {
          id: 'edge.a',
          label: 'a',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'a' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
        {
          id: 'edge.b1',
          label: 'b1',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'b1' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
        {
          id: 'edge.b2',
          label: 'b2',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'b2' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
        {
          id: 'edge.c',
          label: 'c',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'c' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
      ],
      migrationEdges: edges,
    });

    const result = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
          migrationEdges: edges,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));

    const rows = await readLedgerRows(driver);
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

    const opCounts = rows.map((r) => (JSON.parse(r.operations) as unknown[]).length);
    expect(opCounts).toEqual([1, 2, 1]);
    const opIds = rows.flatMap((r) =>
      (JSON.parse(r.operations) as Array<{ id: string }>).map((o) => o.id),
    );
    expect(opIds).toEqual(['edge.a', 'edge.b1', 'edge.b2', 'edge.c']);

    expect(parseNullableJsonColumn(rows[0]!.contract_json_before)).toBeNull();
    expect(parseNullableJsonColumn(rows[0]!.contract_json_after)).toBeNull();
    expect(parseNullableJsonColumn(rows[1]!.contract_json_before)).toBeNull();
    expect(parseNullableJsonColumn(rows[1]!.contract_json_after)).toBeNull();
    expect(parseNullableJsonColumn(rows[2]!.contract_json_before)).toBeNull();
    expect(parseNullableJsonColumn(rows[2]!.contract_json_after)).toMatchObject({
      storage: { storageHash: destHash },
    });
  });

  it('writes one synthesised ledger row with space for synth apply without migrationEdges', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const planner = sqliteTargetDescriptor.createPlanner(familyInstance);
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
    });
    if (result.kind !== 'success') throw new Error('expected planner success');

    const executeResult = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          plan: result.plan,
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });
    if (!executeResult.ok) throw new Error(formatRunnerFailure(executeResult.failure));

    const rows = await readLedgerRows(driver);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      space: APP_SPACE_ID,
      migration_name: '',
      migration_hash: contract.storage.storageHash,
      destination_core_hash: contract.storage.storageHash,
    });
  });
});
