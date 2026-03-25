import {
  BinaryExpr,
  ColumnRef,
  NullCheckExpr,
  OperationExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { describe, expect, it } from 'vitest';
import { buildWhereExpr } from '../src/sql/predicate-builder';
import type { Contract } from './fixtures/contract.d';
import { createFixtureContext, loadFixtureContract } from './test-helpers';

const vectorReturn = { kind: 'typeId', type: 'pg/vector@1' } as const;

describe('buildWhereExpr', () => {
  const contract = loadFixtureContract<Contract>('contract');
  const context = createFixtureContext(contract);
  const tables = schema<Contract>(context).tables;
  const userColumns = tables.user.columns;

  it('rejects invalid left and right operands', () => {
    expect(() =>
      buildWhereExpr(
        contract,
        {
          kind: 'binary',
          op: 'eq',
          left: { kind: 'invalid' } as never,
          right: param('userId'),
        } as never,
        { userId: 1 },
        [],
        [],
      ),
    ).toThrow('Failed to build WHERE clause');

    expect(() =>
      buildWhereExpr(
        contract,
        {
          kind: 'binary',
          op: 'eq',
          left: userColumns.id,
          right: { kind: 'invalid' } as never,
        } as never,
        { userId: 1 },
        [],
        [],
      ),
    ).toThrow('Failed to build WHERE clause');
  });

  it('builds operation-based and column-to-column predicates', () => {
    const operation = OperationExpr.function({
      method: 'normalize',
      forTypeId: 'pg/vector@1',
      self: ColumnRef.of('user', 'id'),
      args: [],
      returns: vectorReturn,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
      template: 'normalize(${self})',
    });
    const opResult = buildWhereExpr(
      contract,
      { kind: 'binary', op: 'eq', left: operation, right: param('value') } as never,
      { value: 'test' },
      [],
      [],
    );
    const columnResult = buildWhereExpr(contract, userColumns.id.eq(userColumns.id), {}, [], []);

    expect(opResult.expr).toEqual(BinaryExpr.eq(operation, ParamRef.of(1, 'value')));
    expect(columnResult.expr).toEqual(
      BinaryExpr.eq(ColumnRef.of('user', 'id'), ColumnRef.of('user', 'id')),
    );
    expect(columnResult.paramName).toBe('');
  });

  it('validates left and right column refs against the contract', () => {
    expect(() =>
      buildWhereExpr(
        contract,
        {
          kind: 'binary',
          op: 'eq',
          left: ColumnRef.of('missing', 'id'),
          right: param('userId'),
        } as never,
        { userId: 1 },
        [],
        [],
      ),
    ).toThrow('Unknown table missing');

    expect(() =>
      buildWhereExpr(
        contract,
        {
          kind: 'binary',
          op: 'eq',
          left: userColumns.id.toExpr(),
          right: {
            kind: 'column',
            table: 'user',
            column: 'missing',
            columnMeta: userColumns.id.columnMeta,
            toExpr: () => ColumnRef.of('user', 'missing'),
          },
        } as never,
        {},
        [],
        [],
      ),
    ).toThrow('Unknown column missing');
  });

  it('builds null-check predicates and validates referenced columns', () => {
    expect(buildWhereExpr(contract, userColumns.deletedAt.isNull(), {}, [], []).expr).toEqual(
      NullCheckExpr.isNull(ColumnRef.of('user', 'deletedAt')),
    );
    expect(() =>
      buildWhereExpr(
        contract,
        { kind: 'nullCheck', expr: ColumnRef.of('missing', 'id'), isNull: true } as never,
        {},
        [],
        [],
      ),
    ).toThrow('Unknown table missing');

    expect(() =>
      buildWhereExpr(
        contract,
        { kind: 'nullCheck', expr: ColumnRef.of('user', 'missing'), isNull: true } as never,
        {},
        [],
        [],
      ),
    ).toThrow('Unknown column missing in table user');
  });

  it('validates missing columns and tables on the right side', () => {
    expect(() =>
      buildWhereExpr(
        contract,
        {
          kind: 'binary',
          op: 'eq',
          left: ColumnRef.of('user', 'missing'),
          right: param('userId'),
        } as never,
        { userId: 1 },
        [],
        [],
      ),
    ).toThrow('Unknown column missing in table user');

    expect(() =>
      buildWhereExpr(
        contract,
        {
          kind: 'binary',
          op: 'eq',
          left: userColumns.id.toExpr(),
          right: {
            kind: 'column',
            table: 'missing',
            column: 'id',
            columnMeta: userColumns.id.columnMeta,
            toExpr: () => ColumnRef.of('missing', 'id'),
          },
        } as never,
        {},
        [],
        [],
      ),
    ).toThrow('Unknown table missing');
  });

  it('rejects missing parameter values', () => {
    expect(() =>
      buildWhereExpr(contract, userColumns.id.eq(param('missingParam')), {}, [], []),
    ).toThrow('Missing value for parameter missingParam');
  });
});
