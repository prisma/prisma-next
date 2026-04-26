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
            settings: { codecId: 'pg/json@1', nativeType: 'json', nullable: true },
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

  it('matches on JSON, JSONB, and vector ParamRef casts', () => {
    const jsonbAst = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'profile'),
          ParamRef.of({ active: true }, { name: 'profile', codecId: 'pg/jsonb@1' }),
        ),
      );
    const jsonAst = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'settings'),
          ParamRef.of({ darkMode: true }, { name: 'settings', codecId: 'pg/json@1' }),
        ),
      );
    const vectorAst = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'vector'),
          ParamRef.of([1, 2, 3], { name: 'vec', codecId: 'pg/vector@1' }),
        ),
      );
    expectParity(jsonbAst);
    expectParity(jsonAst);
    expectParity(vectorAst);

    expect(runtimeAdapter.lower(jsonbAst, { contract }).body.sql).toContain('::jsonb');
    expect(runtimeAdapter.lower(jsonAst, { contract }).body.sql).toContain('::json');
    expect(runtimeAdapter.lower(vectorAst, { contract }).body.sql).toContain('::vector');
  });
});
