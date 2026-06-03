import { InsertAst, UpdateAst } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  int4,
  jsonb,
  PostgresTableSource,
  pgTable,
  text,
  textArray,
  timestamptz,
} from '../../src/exports/contract-free';

describe('postgres column type helpers', () => {
  it('text() returns a non-nullable text descriptor by default', () => {
    const col = text();
    expect(col.codecId).toBe('pg/text@1');
    expect(col.nullable).toBe(false);
  });

  it('text({ nullable: true }) returns a nullable descriptor', () => {
    expect(text({ nullable: true }).nullable).toBe(true);
  });

  it('int4() binds pg/int4@1 codec', () => {
    expect(int4().codecId).toBe('pg/int4@1');
  });

  it('jsonb() binds pg/jsonb@1 codec', () => {
    expect(jsonb().codecId).toBe('pg/jsonb@1');
  });

  it('textArray() binds pg/text-array@1 codec', () => {
    expect(textArray().codecId).toBe('pg/text-array@1');
  });

  it('timestamptz() binds pg/timestamptz@1 codec', () => {
    expect(timestamptz().codecId).toBe('pg/timestamptz@1');
  });
});

describe('pgTable()', () => {
  const marker = pgTable(
    { name: 'marker', schema: 'prisma_contract' },
    {
      space: text(),
      core_hash: text(),
      contract_json: jsonb({ nullable: true }),
      canonical_version: int4({ nullable: true }),
      updated_at: timestamptz(),
      invariants: textArray(),
    },
  );

  it('creates a PostgresTableSource', () => {
    expect(marker.source).toBeInstanceOf(PostgresTableSource);
    expect(marker.source.name).toBe('marker');
    expect((marker.source as PostgresTableSource).schema).toBe('prisma_contract');
  });

  it('exposes typed column proxies', () => {
    expect(marker.space.codecId).toBe('pg/text@1');
    expect(marker.space.nullable).toBe(false);
    expect(marker.contract_json.nullable).toBe(true);
    expect(marker.invariants.codecId).toBe('pg/text-array@1');
  });

  it('column proxy .eq() carries the column codec in the emitted ParamRef', () => {
    const expr = marker.space.eq('my-space');
    const binary = expr.ast as import('@prisma-next/sql-relational-core/ast').BinaryExpr;
    expect(binary.right.kind).toBe('param-ref');
    const param = binary.right as import('@prisma-next/sql-relational-core/ast').ParamRef;
    expect(param.codec?.codecId).toBe('pg/text@1');
  });

  it('.update().set().where().build() produces UpdateAst', () => {
    const ast = marker
      .update()
      .set({ core_hash: 'new-hash' })
      .where(marker.space.eq('my-space').and(marker.core_hash.eq('old-hash')))
      .returning(marker.space)
      .build();

    expect(ast).toBeInstanceOf(UpdateAst);
    expect(ast.table.name).toBe('marker');
    expect(ast.where?.kind).toBe('and');
    expect(ast.returning?.length).toBe(1);
    expect(ast.returning?.[0]?.alias).toBe('space');
  });

  it('.upsert().onConflict().doUpdate(excluded => ...).build() produces InsertAst', () => {
    const ast = marker
      .upsert({
        space: 'my-space',
        core_hash: 'hash',
        contract_json: null,
        canonical_version: null,
        updated_at: null,
        invariants: [],
      })
      .onConflict(marker.space)
      .doUpdate((excluded) => ({
        core_hash: excluded.core_hash,
        contract_json: excluded.contract_json,
      }))
      .build();

    expect(ast).toBeInstanceOf(InsertAst);
    expect(ast.onConflict?.action.kind).toBe('do-update-set');
    const action = ast.onConflict!.action as unknown as { set: { core_hash: unknown } };
    expect(
      (action.set.core_hash as import('@prisma-next/sql-relational-core/ast').ColumnRef).table,
    ).toBe('excluded');
  });
});
