import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParamDescriptor } from '@prisma-next/contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { OperationExpr } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef } from '@prisma-next/sql-relational-core/ast';
import { createExpressionBuilder } from '@prisma-next/sql-relational-core/expression-builder';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type {
  AnyExpressionBuilder,
  PredicateBuilder,
} from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { buildWhereExpr } from '../src/sql/predicate-builder';
import type { Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

describe('buildWhereExpr', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema<Contract>(context).tables;
  const userColumns = tables.user.columns;

  it('builds nullCheck predicate (isNull)', () => {
    const where = userColumns.deletedAt.isNull();
    const result = buildWhereExpr(contract, where, {}, [], []);

    expect(result.expr).toMatchObject({
      kind: 'nullCheck',
      op: 'isNull',
      expr: { table: 'user', column: 'deletedAt' },
    });
    expect(result.codecId).toBeUndefined();
    expect(result.paramName).toBe('');
  });

  it('builds nullCheck predicate (isNotNull)', () => {
    const where = userColumns.deletedAt.isNotNull();
    const result = buildWhereExpr(contract, where, {}, [], []);

    expect(result.expr).toMatchObject({
      kind: 'nullCheck',
      op: 'isNotNull',
      expr: { table: 'user', column: 'deletedAt' },
    });
    expect(result.codecId).toBeUndefined();
    expect(result.paramName).toBe('');
  });

  it('builds binary predicate with param placeholder', () => {
    const where = userColumns.id.eq(param('userId'));
    const paramsMap = { userId: 42 };
    const paramDescriptors: ParamDescriptor[] = [];
    const paramValues: unknown[] = [];

    const result = buildWhereExpr(contract, where, paramsMap, paramDescriptors, paramValues);

    expect(result.expr).toMatchObject({
      kind: 'bin',
      op: 'eq',
      left: { table: 'user', column: 'id' },
      right: { kind: 'param', name: 'userId' },
    });
    expect(result.codecId).toBe('pg/int4@1');
    expect(result.paramName).toBe('userId');
    expect(paramValues).toEqual([42]);
  });

  it('builds binary predicate with column-to-column comparison', () => {
    const where = userColumns.id.eq(userColumns.email as unknown as typeof userColumns.id);
    const result = buildWhereExpr(contract, where, {}, [], []);

    expect(result.expr).toMatchObject({
      kind: 'bin',
      op: 'eq',
      left: { table: 'user', column: 'id' },
      right: { table: 'user', column: 'email' },
    });
    expect(result.codecId).toBe('pg/int4@1');
    expect(result.paramName).toBe('');
  });

  it('builds binary predicate with operation expression in left side', () => {
    const operationExpr: OperationExpr = {
      kind: 'operation',
      method: 'normalize',
      forTypeId: 'pg/vector@1',
      self: createColumnRef('user', 'id'),
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };

    const columnWithOp = createExpressionBuilder(operationExpr, {
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    }) as AnyExpressionBuilder;

    const where = columnWithOp.eq(param('value'));
    const paramsMap = { value: 42 };
    const paramDescriptors: ParamDescriptor[] = [];
    const paramValues: unknown[] = [];

    const result = buildWhereExpr(contract, where, paramsMap, paramDescriptors, paramValues);

    expect(result.expr).toMatchObject({
      kind: 'bin',
      op: 'eq',
      left: { kind: 'operation', method: 'normalize' },
      right: { kind: 'param', name: 'value' },
    });
    expect(result.codecId).toBeUndefined(); // Operation expressions don't have codecId from contract
    expect(result.paramName).toBe('value');
  });

  it('throws when table does not exist for left column', () => {
    const invalidContract = {
      ...contract,
      storage: {
        ...contract.storage,
        tables: {},
      },
    } as Contract;

    const where = userColumns.id.eq(param('userId'));

    expect(() => buildWhereExpr(invalidContract, where, {}, [], [])).toThrow('Unknown table user');
  });

  it('throws when column does not exist for left column', () => {
    const invalidContract = {
      ...contract,
      storage: {
        ...contract.storage,
        tables: {
          user: {
            ...contract.storage.tables.user,
            columns: {},
          },
        },
      },
    } as Contract;

    const where = userColumns.id.eq(param('userId'));

    expect(() => buildWhereExpr(invalidContract, where, {}, [], [])).toThrow(
      'Unknown column id in table user',
    );
  });

  it('throws when table does not exist for right column', () => {
    const invalidContract = {
      ...contract,
      storage: {
        ...contract.storage,
        tables: {},
      },
    } as Contract;

    const where = userColumns.id.eq(userColumns.email as unknown as typeof userColumns.id);

    expect(() => buildWhereExpr(invalidContract, where, {}, [], [])).toThrow('Unknown table user');
  });

  it('throws when column does not exist for right column', () => {
    const invalidContract = {
      ...contract,
      storage: {
        ...contract.storage,
        tables: {
          user: {
            ...contract.storage.tables.user,
            columns: {
              id: contract.storage.tables.user.columns.id,
            },
          },
        },
      },
    } as Contract;

    const where = userColumns.id.eq(userColumns.email as unknown as typeof userColumns.id);

    expect(() => buildWhereExpr(invalidContract, where, {}, [], [])).toThrow(
      'Unknown column email in table user',
    );
  });

  it('throws when parameter is missing', () => {
    const where = userColumns.id.eq(param('userId'));

    expect(() => buildWhereExpr(contract, where, {}, [], [])).toThrow(
      'Missing value for parameter userId',
    );
  });

  it('throws when where.right is invalid', () => {
    const where = {
      kind: 'binary' as const,
      op: 'eq' as const,
      left: userColumns.id,
      right: null as unknown,
    } as unknown as PredicateBuilder;

    expect(() => buildWhereExpr(contract, where, {}, [], [])).toThrow(
      'Failed to build WHERE clause',
    );
  });
});
