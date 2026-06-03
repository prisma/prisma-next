import { InsertAst, UpdateAst } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { datetime, integer, jsonText, sqliteTable, text } from '../../src/exports/contract-free';

describe('sqlite column type helpers', () => {
  it('text() returns a non-nullable text descriptor', () => {
    const col = text();
    expect(col.codecId).toBe('sqlite/text@1');
    expect(col.nullable).toBe(false);
  });

  it('text({ nullable: true }) returns a nullable descriptor', () => {
    expect(text({ nullable: true }).nullable).toBe(true);
  });

  it('integer() binds sqlite/integer@1 codec', () => {
    expect(integer().codecId).toBe('sqlite/integer@1');
  });

  it('jsonText() binds sqlite/json@1 codec', () => {
    expect(jsonText().codecId).toBe('sqlite/json@1');
  });

  it('datetime() binds sqlite/datetime@1 codec', () => {
    expect(datetime().codecId).toBe('sqlite/datetime@1');
  });
});

describe('sqliteTable()', () => {
  const marker = sqliteTable('_prisma_marker', {
    space: text(),
    core_hash: text(),
    contract_json: jsonText({ nullable: true }),
    canonical_version: integer({ nullable: true }),
    updated_at: datetime(),
    invariants: jsonText(),
  });

  it('creates a TableSource with the flat name', () => {
    expect(marker.source.name).toBe('_prisma_marker');
  });

  it('exposes typed column proxies', () => {
    expect(marker.space.codecId).toBe('sqlite/text@1');
    expect(marker.space.nullable).toBe(false);
    expect(marker.contract_json.nullable).toBe(true);
    expect(marker.invariants.codecId).toBe('sqlite/json@1');
  });

  it('.update().set().where().build() produces UpdateAst with correct codec in WHERE', () => {
    const ast = marker
      .update()
      .set({ core_hash: 'new-hash' })
      .where(marker.space.eq('my-space').and(marker.core_hash.eq('old-hash')))
      .returning(marker.space)
      .build();

    expect(ast).toBeInstanceOf(UpdateAst);
    expect(ast.table.name).toBe('_prisma_marker');
    expect(ast.where?.kind).toBe('and');
    expect(ast.returning?.length).toBe(1);
  });

  it('.upsert().onConflict().doNothing().build() produces InsertAst', () => {
    const ast = marker
      .upsert({
        space: 's',
        core_hash: 'h',
        contract_json: null,
        canonical_version: null,
        updated_at: null,
        invariants: [],
      })
      .onConflict(marker.space)
      .doNothing()
      .build();

    expect(ast).toBeInstanceOf(InsertAst);
    expect(ast.onConflict?.action.kind).toBe('do-nothing');
  });
});
