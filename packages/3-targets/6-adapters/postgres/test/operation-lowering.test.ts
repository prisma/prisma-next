import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  OperationExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../src/core/adapter';
import type { PostgresContract } from '../src/core/types';

const contract = validateContract<PostgresContract>({
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: 'test-hash',
  storage: {
    tables: {
      user: {
        columns: {
          id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
          email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          vector: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
          otherVector: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  models: {},
  relations: {},
  mappings: {},
});

describe('Operation lowering', () => {
  const adapter = createPostgresAdapter();

  function distanceExpr() {
    return new OperationExpr({
      method: 'cosineDistance',
      forTypeId: 'pg/vector@1',
      self: ColumnRef.of('user', 'vector'),
      args: [ParamRef.of([1, 2, 3], { name: 'other', codecId: 'pg/vector@1' })],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
        template: '${self} <=> ${arg0}',
      },
    });
  }

  it('lowers infix operations in projections', () => {
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('user', 'id')),
      ProjectionItem.of('distance', distanceExpr()),
    ]);

    const lowered = adapter.lower(ast, { contract });
    expect(lowered.body.sql).toContain('"user"."vector" <=> $1::vector');
    expect(lowered.body.sql).toContain('AS "distance"');
  });

  it('lowers function operations with multiple arguments', () => {
    const operationExpr = OperationExpr.function({
      method: 'cosineSimilarity',
      forTypeId: 'pg/vector@1',
      self: ColumnRef.of('user', 'vector'),
      args: [
        ColumnRef.of('user', 'otherVector'),
        ParamRef.of([1, 2, 3], { name: 'param', codecId: 'pg/vector@1' }),
        LiteralExpr.of(42),
      ],
      returns: { kind: 'builtin', type: 'number' },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
      template: 'cosine_similarity(${self}, ${arg0}, ${arg1}, ${arg2})',
    });
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('similarity', operationExpr),
    ]);

    const lowered = adapter.lower(ast, { contract });
    expect(lowered.body.sql).toContain(
      'cosine_similarity("user"."vector", "user"."otherVector", $1::vector, 42)',
    );
  });

  it('lowers operations in where and orderBy clauses', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(BinaryExpr.eq(distanceExpr(), ParamRef.of(0.5, { name: 'threshold' })))
      .withOrderBy([OrderByItem.asc(distanceExpr())]);

    const lowered = adapter.lower(ast, { contract });

    expect(lowered.body.sql).toContain('WHERE ("user"."vector" <=> $1::vector) = $2');
    expect(lowered.body.sql).toContain('ORDER BY "user"."vector" <=> $3::vector ASC');
  });

  it('lowers operations with literal arguments', () => {
    const operationExpr = new OperationExpr({
      method: 'contains',
      forTypeId: 'pg/text@1',
      self: ColumnRef.of('user', 'email'),
      args: [LiteralExpr.of("test'value")],
      returns: { kind: 'builtin', type: 'boolean' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template
        template: 'contains(${self}, ${arg0})',
      },
    });
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('matches', operationExpr),
    ]);

    const lowered = adapter.lower(ast, { contract, params: [] });
    expect(lowered.body.sql).toContain(`contains("user"."email", 'test''value')`);
  });
});
