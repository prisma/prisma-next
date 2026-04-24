import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  InsertAst,
  InsertOnConflict,
  LiteralExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../src/core/adapter';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

const contract = validateContract<PostgresContract>(
  {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: 'sha256:test-profile',
    roots: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    storage: {
      storageHash: 'sha256:test-core',
      tables: {
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            profile: { codecId: 'pg/jsonb@1', nativeType: 'jsonb', nullable: true },
            vector: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
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

const runtimeAdapter = createPostgresAdapter();
const controlAdapter = new PostgresControlAdapter();

function expectParity(ast: AnyQueryAst): void {
  const runtime = runtimeAdapter.lower(ast, { contract });
  const control = controlAdapter.lower(ast, { contract });
  expect(control.sql).toBe(runtime.body.sql);
  expect(control.params).toEqual(runtime.body.params);
}

describe('PostgresControlAdapter.lower / PostgresAdapterImpl.lower parity', () => {
  it('matches on simple SELECT with literal WHERE', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'email'), LiteralExpr.of('a@example.com')));
    expectParity(ast);
  });

  it('matches on INSERT with ON CONFLICT and RETURNING', () => {
    const ast = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
          email: ParamRef.of('a@example.com', { name: 'email', codecId: 'pg/text@1' }),
        },
        {
          id: ParamRef.of(2, { name: 'id2', codecId: 'pg/int4@1' }),
          email: new DefaultValueExpr(),
        },
      ])
      .withOnConflict(
        InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
          email: ColumnRef.of('excluded', 'email'),
        }),
      )
      .withReturning([ColumnRef.of('user', 'id')]);
    expectParity(ast);
  });

  it('matches on UPDATE with parameterized WHERE', () => {
    const ast = UpdateAst.table(TableSource.named('user'))
      .withSet({ email: ParamRef.of('b@example.com', { name: 'email', codecId: 'pg/text@1' }) })
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
        ),
      )
      .withReturning([ColumnRef.of('user', 'email')]);
    expectParity(ast);
  });

  it('matches on DELETE with RETURNING', () => {
    const ast = DeleteAst.from(TableSource.named('user'))
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codecId: 'pg/int4@1' }),
        ),
      )
      .withReturning([ColumnRef.of('user', 'id')]);
    expectParity(ast);
  });

  it('matches on JSONB and vector ParamRef casts', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'profile'),
          ParamRef.of({ active: true }, { name: 'profile', codecId: 'pg/jsonb@1' }),
        ),
      );
    const ast2 = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'vector'),
          ParamRef.of([1, 2, 3], { name: 'vec', codecId: 'pg/vector@1' }),
        ),
      );
    expectParity(ast);
    expectParity(ast2);

    const runtime = runtimeAdapter.lower(ast, { contract });
    expect(runtime.body.sql).toContain('::jsonb');
    const runtimeVec = runtimeAdapter.lower(ast2, { contract });
    expect(runtimeVec.body.sql).toContain('::vector');
  });
});
