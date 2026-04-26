import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
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

const contract = validateContract<PostgresContract>(
  {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: 'sha256:test',
    roots: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    storage: {
      storageHash: 'test-hash',
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
  },
  emptyCodecLookup,
);

describe('Operation lowering', () => {
  const adapter = createPostgresAdapter();

  function distanceExpr() {
    return new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('user', 'vector'),
      args: [ParamRef.of([1, 2, 3], { name: 'other', codecId: 'pg/vector@1' })],
      returns: { codecId: 'core/float8', nullable: false },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '{{self}} <=> {{arg0}}',
      },
    });
  }

  it('lowers infix operations in projections', () => {
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('user', 'id')),
      ProjectionItem.of('distance', distanceExpr()),
    ]);

    const lowered = adapter.lower(ast, { contract });
    expect(lowered.sql).toContain('"user"."vector" <=> $1::vector');
    expect(lowered.sql).toContain('AS "distance"');
  });

  it('lowers function operations with multiple arguments', () => {
    const operationExpr = new OperationExpr({
      method: 'cosineSimilarity',
      self: ColumnRef.of('user', 'vector'),
      args: [
        ColumnRef.of('user', 'otherVector'),
        ParamRef.of([1, 2, 3], { name: 'param', codecId: 'pg/vector@1' }),
        LiteralExpr.of(42),
      ],
      returns: { codecId: 'core/float8', nullable: false },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template: 'cosine_similarity({{self}}, {{arg0}}, {{arg1}}, {{arg2}})',
      },
    });
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('similarity', operationExpr),
    ]);

    const lowered = adapter.lower(ast, { contract });
    expect(lowered.sql).toContain(
      'cosine_similarity("user"."vector", "user"."otherVector", $1::vector, 42)',
    );
  });

  it('lowers operations in where and orderBy clauses', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          distanceExpr(),
          ParamRef.of(0.5, { name: 'threshold', codecId: 'pg/float8@1' }),
        ),
      )
      .withOrderBy([OrderByItem.asc(distanceExpr())]);

    const lowered = adapter.lower(ast, { contract });

    expect(lowered.sql).toContain('WHERE ("user"."vector" <=> $1::vector) = $2');
    expect(lowered.sql).toContain('ORDER BY "user"."vector" <=> $3::vector ASC');
  });

  it('lowers operations with literal arguments', () => {
    const operationExpr = new OperationExpr({
      method: 'contains',
      self: ColumnRef.of('user', 'email'),
      args: [LiteralExpr.of("test'value")],
      returns: { codecId: 'core/bool', nullable: false },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template: 'contains({{self}}, {{arg0}})',
      },
    });
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('matches', operationExpr),
    ]);

    const lowered = adapter.lower(ast, { contract, params: [] });
    expect(lowered.sql).toContain(`contains("user"."email", 'test''value')`);
  });

  it('does not re-substitute tokens that appear inside an already-rendered argument', () => {
    // Regression: the previous implementation called `String.prototype.replace`
    // for `{{self}}` first and then for each `{{argN}}` against the running
    // result, so a literal containing `{{arg1}}` rendered into the SQL got
    // corrupted on the second pass. The single-pass callback must preserve it.
    const operationExpr = new OperationExpr({
      method: 'echo',
      self: LiteralExpr.of('{{arg1}}'),
      args: [LiteralExpr.of('replacement')],
      returns: { codecId: 'pg/text@1', nullable: false },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template: 'echo({{self}}, {{arg0}})',
      },
    });
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('echoed', operationExpr),
    ]);

    const lowered = adapter.lower(ast, { contract, params: [] });
    expect(lowered.sql).toContain(`echo('{{arg1}}', 'replacement')`);
  });
});
