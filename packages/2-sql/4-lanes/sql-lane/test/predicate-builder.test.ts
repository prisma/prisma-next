import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { createColumnRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
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

  it('throws error when where.left is neither OperationExpr nor ColumnBuilder', () => {
    const invalidBinary = {
      kind: 'binary' as const,
      op: 'eq' as const,
      left: { kind: 'invalid' } as unknown,
      right: param('userId'),
    };

    // @ts-expect-error - Intentionally testing invalid input
    expect(() => buildWhereExpr(contract, invalidBinary, { userId: 1 }, [], [])).toThrow(
      'Failed to build WHERE clause',
    );
  });

  it('throws error when where.right is neither ParamPlaceholder nor ColumnBuilder', () => {
    const invalidBinary = {
      kind: 'binary' as const,
      op: 'eq' as const,
      left: userColumns.id,
      right: { kind: 'invalid' } as unknown,
    };

    // @ts-expect-error - Intentionally testing invalid input
    expect(() => buildWhereExpr(contract, invalidBinary, { userId: 1 }, [], [])).toThrow(
      'Failed to build WHERE clause',
    );
  });

  it('builds where expression with operation expression on left', () => {
    const operationExpr = {
      kind: 'operation' as const,
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

    const columnWithOp = {
      ...userColumns.id,
      _operationExpr: operationExpr,
    } as unknown;

    const binary = {
      kind: 'binary' as const,
      op: 'eq' as const,
      left: columnWithOp,
      right: param('value'),
    } as unknown;

    const result = buildWhereExpr(
      contract,
      binary as unknown as typeof userColumns.id.eq extends (x: unknown) => infer R ? R : never,
      { value: 'test' },
      [],
      [],
    );

    expect(result.expr).toMatchObject({
      kind: 'bin',
      op: 'eq',
      left: {
        kind: 'operation',
        method: 'normalize',
      },
    });
  });

  it('builds where expression with column-to-column comparison', () => {
    const binary = {
      kind: 'binary' as const,
      op: 'eq' as const,
      left: userColumns.id,
      right: userColumns.id,
    } as unknown;

    const result = buildWhereExpr(
      contract,
      binary as unknown as typeof userColumns.id.eq extends (x: unknown) => infer R ? R : never,
      {},
      [],
      [],
    );

    expect(result.expr).toMatchObject({
      kind: 'bin',
      op: 'eq',
      left: { kind: 'col', table: 'user', column: 'id' },
      right: { kind: 'col', table: 'user', column: 'id' },
    });
    expect(result.paramName).toBe('');
  });
});
