import type { Contract } from '@prisma-next/contract/types';
import { CliStructuredError } from '@prisma-next/errors/control';
import { placeholder } from '@prisma-next/errors/migration';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';

const lowerSqlPlanMock = vi.fn();

vi.mock('@prisma-next/sql-runtime', async () => {
  const actual = await vi.importActual<typeof import('@prisma-next/sql-runtime')>(
    '@prisma-next/sql-runtime',
  );
  return { ...actual, lowerSqlPlan: lowerSqlPlanMock };
});

const { dataTransform } = await import('../../src/core/migrations/operations/data-transform');

const CONTRACT_HASH = 'sha256:contract-abc';

function makeContract(storageHash: string = CONTRACT_HASH): Contract<SqlStorage> {
  return {
    storage: { storageHash, tables: {}, extensions: {}, schemas: [], types: {} },
    profile: { profileHash: 'sha256:profile', lanes: {} },
  } as unknown as Contract<SqlStorage>;
}

function makePlan(storageHash: string = CONTRACT_HASH): SqlQueryPlan {
  return {
    ast: { kind: 'synthetic-test-ast' } as unknown as SqlQueryPlan['ast'],
    params: [1, 'x'] as unknown as SqlQueryPlan['params'],
    meta: {
      target: 'postgres',
      storageHash,
      lane: 'sql',
      paramDescriptors: [],
    } as unknown as SqlQueryPlan['meta'],
  };
}

describe('dataTransform (class-flow factory)', () => {
  beforeEachTest();

  it('returns a DataTransformOperation with a single run entry and no check', () => {
    lowerSqlPlanMock.mockImplementation((_adapter, _contract, plan: SqlQueryPlan) => ({
      sql: 'UPDATE users SET email = $1',
      params: plan.params,
      ast: plan.ast,
      meta: plan.meta,
    }));
    const op = dataTransform(makeContract(), 'backfill-emails', {
      run: () => makePlan(),
    });
    expect(op).toMatchObject({
      id: 'data_migration.backfill-emails',
      label: 'Data transform: backfill-emails',
      operationClass: 'data',
      name: 'backfill-emails',
      source: 'migration.ts',
      check: null,
      run: [{ sql: 'UPDATE users SET email = $1', params: [1, 'x'] }],
    });
  });

  it('supports a readonly array of run closures', () => {
    let call = 0;
    lowerSqlPlanMock.mockImplementation((_a, _c, plan: SqlQueryPlan) => ({
      sql: `STMT_${call++}`,
      params: plan.params,
      ast: plan.ast,
      meta: plan.meta,
    }));
    const op = dataTransform(makeContract(), 'multi', {
      run: [() => makePlan(), () => makePlan()],
    });
    expect(op.run).toHaveLength(2);
    expect(op.run).toEqual([
      { sql: 'STMT_0', params: [1, 'x'] },
      { sql: 'STMT_1', params: [1, 'x'] },
    ]);
  });

  it('invokes and lowers the check closure when provided', () => {
    lowerSqlPlanMock.mockImplementation((_a, _c, plan: SqlQueryPlan) => ({
      sql: 'SELECT count(*)',
      params: plan.params,
      ast: plan.ast,
      meta: plan.meta,
    }));
    const op = dataTransform(makeContract(), 'with-check', {
      check: () => makePlan(),
      run: () => makePlan(),
    });
    expect(op.check).toEqual({ sql: 'SELECT count(*)', params: [1, 'x'] });
  });

  it('propagates PN-MIG-2001 when a closure is a placeholder (never reaches the adapter)', () => {
    lowerSqlPlanMock.mockImplementation(() => {
      throw new Error('lowerSqlPlan should not be called for placeholder closures');
    });
    expect(() =>
      dataTransform(makeContract(), 'not-yet-filled', {
        run: () => placeholder('not-yet-filled:run'),
      }),
    ).toThrow(
      expect.objectContaining({
        code: '2001',
        domain: 'MIG',
        meta: { slot: 'not-yet-filled:run' },
      }),
    );
  });

  it('throws PN-MIG-2005 when a plan storageHash does not match the contract', () => {
    lowerSqlPlanMock.mockImplementation(() => {
      throw new Error('lowerSqlPlan should not be called when the hash check fails');
    });
    try {
      dataTransform(makeContract(), 'mismatched', {
        run: () => makePlan('sha256:someone-elses-contract'),
      });
      expect.fail('expected dataTransform to throw');
    } catch (error) {
      expect(CliStructuredError.is(error)).toBe(true);
      const e = error as CliStructuredError;
      expect(e.code).toBe('2005');
      expect(e.domain).toBe('MIG');
      expect(e.meta).toMatchObject({
        dataTransformName: 'mismatched',
        expected: CONTRACT_HASH,
        actual: 'sha256:someone-elses-contract',
      });
    }
  });

  it('accepts a Buildable by calling build() once', () => {
    lowerSqlPlanMock.mockImplementation((_a, _c, plan: SqlQueryPlan) => ({
      sql: 'SELECT 1',
      params: plan.params,
      ast: plan.ast,
      meta: plan.meta,
    }));
    const build = vi.fn(() => makePlan());
    const op = dataTransform(makeContract(), 'from-buildable', {
      run: () => ({ build }),
    });
    expect(build).toHaveBeenCalledTimes(1);
    expect(op.run).toHaveLength(1);
  });
});

function beforeEachTest(): void {
  // Keep the singleton adapter stable; only the lowerSqlPlan mock changes
  // between tests. Re-set default impl so unrelated tests don't leak state.
  lowerSqlPlanMock.mockReset();
}
