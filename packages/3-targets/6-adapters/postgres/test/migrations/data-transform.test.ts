import type { Contract } from '@prisma-next/contract/types';
import { CliStructuredError } from '@prisma-next/errors/control';
import { placeholder } from '@prisma-next/errors/migration';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { dataTransform } from '@prisma-next/target-postgres/data-transform';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CONTRACT_HASH = 'sha256:contract-abc';

const lowerMock = vi.fn();

function makeAdapter(): SqlControlAdapter<'postgres'> {
  return { lower: lowerMock } as unknown as SqlControlAdapter<'postgres'>;
}

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

describe('dataTransform factory', () => {
  beforeEach(() => {
    lowerMock.mockReset();
  });

  it('returns a DataTransformOperation with a single run entry and no check', () => {
    lowerMock.mockImplementation((_ast, _ctx) => ({
      sql: 'UPDATE users SET email = $1',
      params: [1, 'x'],
    }));
    const op = dataTransform(
      makeContract(),
      'backfill-emails',
      { run: () => makePlan() },
      makeAdapter(),
    );
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
    lowerMock.mockImplementation(() => ({
      sql: `STMT_${call++}`,
      params: [1, 'x'],
    }));
    const op = dataTransform(
      makeContract(),
      'multi',
      { run: [() => makePlan(), () => makePlan()] },
      makeAdapter(),
    );
    expect(op.run).toHaveLength(2);
    expect(op.run).toEqual([
      { sql: 'STMT_0', params: [1, 'x'] },
      { sql: 'STMT_1', params: [1, 'x'] },
    ]);
  });

  it('invokes and lowers the check closure when provided', () => {
    lowerMock.mockImplementation(() => ({
      sql: 'SELECT count(*)',
      params: [1, 'x'],
    }));
    const op = dataTransform(
      makeContract(),
      'with-check',
      { check: () => makePlan(), run: () => makePlan() },
      makeAdapter(),
    );
    expect(op.check).toEqual({ sql: 'SELECT count(*)', params: [1, 'x'] });
  });

  it('propagates PN-MIG-2001 when a closure is a placeholder (never reaches the adapter)', () => {
    lowerMock.mockImplementation(() => {
      throw new Error('adapter.lower should not be called for placeholder closures');
    });
    expect(() =>
      dataTransform(
        makeContract(),
        'not-yet-filled',
        { run: () => placeholder('not-yet-filled:run') },
        makeAdapter(),
      ),
    ).toThrow(
      expect.objectContaining({
        code: '2001',
        domain: 'MIG',
        meta: { slot: 'not-yet-filled:run' },
      }),
    );
  });

  it('throws PN-MIG-2005 when a plan storageHash does not match the contract', () => {
    lowerMock.mockImplementation(() => {
      throw new Error('adapter.lower should not be called when the hash check fails');
    });
    try {
      dataTransform(
        makeContract(),
        'mismatched',
        { run: () => makePlan('sha256:someone-elses-contract') },
        makeAdapter(),
      );
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
    lowerMock.mockImplementation(() => ({
      sql: 'SELECT 1',
      params: [1, 'x'],
    }));
    const build = vi.fn(() => makePlan());
    const op = dataTransform(
      makeContract(),
      'from-buildable',
      { run: () => ({ build }) },
      makeAdapter(),
    );
    expect(build).toHaveBeenCalledTimes(1);
    expect(op.run).toHaveLength(1);
  });

  it('forwards the contract via LowererContext on every adapter.lower call', () => {
    const contract = makeContract();
    const adapter = makeAdapter();
    lowerMock.mockReturnValue({ sql: 'X', params: [] });
    dataTransform(contract, 'forwards-contract', { run: () => makePlan() }, adapter);
    expect(lowerMock).toHaveBeenCalledWith(expect.anything(), { contract });
  });
});
