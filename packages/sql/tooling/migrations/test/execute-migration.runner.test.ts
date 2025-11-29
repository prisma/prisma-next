import { col, contract, storage, table } from '@prisma-next/sql-contract/factories';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { describe, expect, it } from 'vitest';
import { SqlMigrationExecutionError } from '../src/errors';
import { executeMigration } from '../src/execute-migration';
import { AdvisoryLockError, type SqlMigrationExecutor } from '../src/executor';
import type { SqlMigrationPlan } from '../src/ir';

/**
 * Creates a test contract for testing.
 */
function createTestContract(): SqlContract<SqlStorage> {
  return contract({
    target: 'postgres',
    coreHash: 'sha256:test',
    storage: storage({
      user: table(
        {
          id: col('int4', 'pg/int4@1', false),
          email: col('text', 'pg/text@1', false),
        },
        {},
      ),
    }),
    models: {},
    relations: {},
    mappings: {},
  });
}

/**
 * Creates a test migration plan.
 */
function createTestPlan(): SqlMigrationPlan {
  const fromContract = validateContract<SqlContract<SqlStorage>>(
    contract({
      target: 'postgres',
      coreHash: 'sha256:empty',
      storage: storage({}),
      models: {},
      relations: {},
      mappings: {},
    }),
  );
  const toContract = validateContract<SqlContract<SqlStorage>>(createTestContract());

  return {
    fromContract,
    toContract,
    operations: [
      {
        kind: 'createTable',
        table: 'user',
        columns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    ],
    mode: 'init',
    summary: 'Create user table',
  };
}

/**
 * Fake driver type for testing.
 */
type FakeDriver = { id: string };

describe('executeMigration runner', () => {
  it('calls executor methods in correct order', async () => {
    const plan = createTestPlan();
    const driver: FakeDriver = { id: 'test-driver' };

    const callOrder: string[] = [];
    const executor: SqlMigrationExecutor<FakeDriver> = {
      async readMarker(_driver) {
        callOrder.push('readMarker');
        return null;
      },
      async validateMarkerState(_plan, _marker) {
        callOrder.push('validateMarkerState');
      },
      async withMigrationLock(_driver, fn) {
        callOrder.push('withMigrationLock-start');
        try {
          return await fn();
        } finally {
          callOrder.push('withMigrationLock-end');
        }
      },
      async ensureInfrastructure(_driver) {
        callOrder.push('ensureInfrastructure');
      },
      async applyOperation(_driver, _operation, _index) {
        callOrder.push(`applyOperation-${_index}`);
      },
      async updateMarker(_driver, _plan, _marker) {
        callOrder.push('updateMarker');
      },
      async writeLedger(_driver, _plan, _operationsApplied) {
        callOrder.push('writeLedger');
      },
    };

    const result = await executeMigration({ plan, driver, executor });

    expect(result.ok).toBe(true);
    expect(result.operationsApplied).toBe(1);
    expect(callOrder).toEqual([
      'readMarker',
      'validateMarkerState',
      'withMigrationLock-start',
      'ensureInfrastructure',
      'applyOperation-0',
      'updateMarker',
      'writeLedger',
      'withMigrationLock-end',
    ]);
  });

  it('handles empty operations list', async () => {
    const plan: SqlMigrationPlan = {
      ...createTestPlan(),
      operations: [],
    };
    const driver: FakeDriver = { id: 'test-driver' };

    const executor: SqlMigrationExecutor<FakeDriver> = {
      async readMarker() {
        return null;
      },
      async validateMarkerState() {},
      async withMigrationLock(_driver, fn) {
        return await fn();
      },
      async ensureInfrastructure() {},
      async applyOperation() {
        throw new Error('Should not be called');
      },
      async updateMarker() {},
      async writeLedger(_driver, _plan, operationsApplied) {
        expect(operationsApplied).toBe(0);
      },
    };

    const result = await executeMigration({ plan, driver, executor });

    expect(result.ok).toBe(true);
    expect(result.operationsApplied).toBe(0);
    expect(result.summary).toBe('Migration executed (no operations needed)');
  });

  it('maps AdvisoryLockError to result', async () => {
    const plan = createTestPlan();
    const driver: FakeDriver = { id: 'test-driver' };

    const executor: SqlMigrationExecutor<FakeDriver> = {
      async readMarker() {
        return null;
      },
      async validateMarkerState() {},
      async withMigrationLock() {
        throw new AdvisoryLockError('Lock already held');
      },
      async ensureInfrastructure() {},
      async applyOperation() {},
      async updateMarker() {},
      async writeLedger() {},
    };

    const result = await executeMigration({ plan, driver, executor });

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: 'PN-MIGRATION-LOCK-0001',
      message: 'Lock already held',
    });
  });

  it('maps SqlMigrationExecutionError to result', async () => {
    const plan = createTestPlan();
    const driver: FakeDriver = { id: 'test-driver' };

    const executor: SqlMigrationExecutor<FakeDriver> = {
      async readMarker() {
        return null;
      },
      async validateMarkerState() {
        throw new SqlMigrationExecutionError('Marker validation failed', 'PN-MIGRATION-EXEC-0001', {
          mode: 'init',
        });
      },
      async withMigrationLock(_driver, fn) {
        return await fn();
      },
      async ensureInfrastructure() {},
      async applyOperation() {},
      async updateMarker() {},
      async writeLedger() {},
    };

    const result = await executeMigration({ plan, driver, executor });

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: 'PN-MIGRATION-EXEC-0001',
      message: 'Marker validation failed',
      details: { mode: 'init' },
    });
  });

  it('maps unexpected errors to generic error result', async () => {
    const plan = createTestPlan();
    const driver: FakeDriver = { id: 'test-driver' };

    const executor: SqlMigrationExecutor<FakeDriver> = {
      async readMarker() {
        throw new Error('Unexpected database error');
      },
      async validateMarkerState() {},
      async withMigrationLock(_driver, fn) {
        return await fn();
      },
      async ensureInfrastructure() {},
      async applyOperation() {},
      async updateMarker() {},
      async writeLedger() {},
    };

    const result = await executeMigration({ plan, driver, executor });

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: 'PN-MIGRATION-EXEC-0000',
      message: 'Unexpected database error',
    });
  });

  it('always releases lock even when operation fails', async () => {
    const plan = createTestPlan();
    const driver: FakeDriver = { id: 'test-driver' };

    let lockReleased = false;
    const executor: SqlMigrationExecutor<FakeDriver> = {
      async readMarker() {
        return null;
      },
      async validateMarkerState() {},
      async withMigrationLock(_driver, fn) {
        try {
          return await fn();
        } finally {
          lockReleased = true;
        }
      },
      async ensureInfrastructure() {},
      async applyOperation() {
        throw new SqlMigrationExecutionError('Operation failed', 'PN-MIGRATION-EXEC-0004');
      },
      async updateMarker() {},
      async writeLedger() {},
    };

    const result = await executeMigration({ plan, driver, executor });

    expect(result.ok).toBe(false);
    expect(lockReleased).toBe(true);
  });

  it('applies multiple operations in order', async () => {
    const plan: SqlMigrationPlan = {
      ...createTestPlan(),
      operations: [
        {
          kind: 'createTable',
          table: 'user',
          columns: {},
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        {
          kind: 'addColumn',
          table: 'user',
          column: 'email',
          definition: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
      ],
    };
    const driver: FakeDriver = { id: 'test-driver' };

    const appliedOperations: string[] = [];
    const executor: SqlMigrationExecutor<FakeDriver> = {
      async readMarker() {
        return null;
      },
      async validateMarkerState() {},
      async withMigrationLock(_driver, fn) {
        return await fn();
      },
      async ensureInfrastructure() {},
      async applyOperation(_driver, operation, index) {
        appliedOperations.push(`${index}:${operation.kind}`);
      },
      async updateMarker() {},
      async writeLedger(_driver, _plan, operationsApplied) {
        expect(operationsApplied).toBe(2);
      },
    };

    const result = await executeMigration({ plan, driver, executor });

    expect(result.ok).toBe(true);
    expect(result.operationsApplied).toBe(2);
    expect(appliedOperations).toEqual(['0:createTable', '1:addColumn']);
  });
});
