import { transformKyselyToPnAst } from '@prisma-next/sql-kysely-lane';
import { describe, expect, it } from 'vitest';
import { binaryWhere, contract, selectQueryFixture } from './transform.fixtures';

describe('transformKyselyToPnAst — paramDescriptors', () => {
  it('includes codecId and nativeType when contract has column metadata', () => {
    const query = selectQueryFixture({
      where: binaryWhere('id', 'uid'),
    });
    const result = transformKyselyToPnAst(contract, query, ['uid']);
    const desc = result.metaAdditions.paramDescriptors[0];
    expect(desc).toBeDefined();
    expect(desc).toMatchObject({
      index: 1,
      source: 'lane',
      refs: { table: 'user', column: 'id' },
      codecId: expect.any(String),
      nativeType: expect.any(String),
    });
  });
});

describe('transformKyselyToPnAst — param indexing', () => {
  it('aligns param indices with compiledQuery.parameters order', () => {
    const query = selectQueryFixture({
      where: binaryWhere('id', 'placeholder'),
      limit: {
        kind: 'LimitNode',
        limit: { kind: 'ValueNode', value: 'limit_placeholder' },
      },
    });
    const params = ['user_1', 5];
    const result = transformKyselyToPnAst(contract, query, params);
    expect(result.metaAdditions.paramDescriptors).toHaveLength(2);
    expect(result.metaAdditions.paramDescriptors[0]).toMatchObject({
      index: 1,
      source: 'lane',
      refs: { table: 'user', column: 'id' },
    });
    expect(result.metaAdditions.paramDescriptors[1]).toMatchObject({
      index: 2,
      source: 'lane',
    });
  });

  it('keeps descriptor order aligned with multiple where values', () => {
    const query = selectQueryFixture({
      where: {
        kind: 'WhereNode',
        node: {
          kind: 'AndNode',
          exprs: [
            {
              kind: 'BinaryOperationNode',
              left: {
                kind: 'ReferenceNode',
                column: {
                  kind: 'ColumnNode',
                  column: { kind: 'IdentifierNode', name: 'id' },
                  table: { kind: 'IdentifierNode', name: 'user' },
                },
              },
              operator: { kind: 'OperatorNode', operator: '=' },
              right: { kind: 'ValueNode', value: 'first' },
            },
            {
              kind: 'BinaryOperationNode',
              left: {
                kind: 'ReferenceNode',
                column: {
                  kind: 'ColumnNode',
                  column: { kind: 'IdentifierNode', name: 'email' },
                  table: { kind: 'IdentifierNode', name: 'user' },
                },
              },
              operator: { kind: 'OperatorNode', operator: 'like' },
              right: { kind: 'ValueNode', value: 'second' },
            },
            {
              kind: 'BinaryOperationNode',
              left: {
                kind: 'ReferenceNode',
                column: {
                  kind: 'ColumnNode',
                  column: { kind: 'IdentifierNode', name: 'id' },
                  table: { kind: 'IdentifierNode', name: 'user' },
                },
              },
              operator: { kind: 'OperatorNode', operator: 'in' },
              right: {
                kind: 'PrimitiveValueListNode',
                values: [
                  { kind: 'ValueNode', value: 'third' },
                  { kind: 'ValueNode', value: 'fourth' },
                ],
              },
            },
          ],
        },
      },
    });

    const params = ['first', 'second', 'third', 'fourth'];
    const result = transformKyselyToPnAst(contract, query, params);
    expect(result.metaAdditions.paramDescriptors).toHaveLength(4);
    expect(result.metaAdditions.paramDescriptors.map((p) => p.index)).toEqual([1, 2, 3, 4]);
    expect(result.metaAdditions.paramDescriptors.map((p) => p.source)).toEqual([
      'lane',
      'lane',
      'lane',
      'lane',
    ]);
    expect(result.metaAdditions.paramDescriptors.map((p) => p.refs)).toEqual([
      { table: 'user', column: 'id' },
      { table: 'user', column: 'email' },
      { table: 'user', column: 'id' },
      { table: 'user', column: 'id' },
    ]);
  });
});

describe('transformKyselyToPnAst — ref extraction', () => {
  it('populates meta.refs.tables and meta.refs.columns', () => {
    const result = transformKyselyToPnAst(
      contract,
      selectQueryFixture({ where: binaryWhere('id', 1) }),
      [1],
    );
    expect(result.metaAdditions.refs.tables).toContain('user');
    expect(result.metaAdditions.refs.columns).toContainEqual({
      table: 'user',
      column: 'id',
    });
  });
});
