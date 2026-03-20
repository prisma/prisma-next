import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/prisma/db';

describe('static context (no runtime)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('can build query plans from static context', () => {
    const tables = db.schema.tables;
    const plan = db.sql.from(tables.user).select({ id: tables.user.columns.id }).limit(1).build();

    expect(plan.ast).toBeInstanceOf(SelectAst);
    expect(plan).toMatchObject({
      ast: SelectAst.from(TableSource.named('user'))
        .withLimit(1)
        .withProject([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]),
      meta: { lane: 'dsl' },
    });
  });

  it('importing query roots does not instantiate adapter or extensions', () => {
    const executionStack = db.stack;
    const adapterSpy = vi.spyOn(executionStack.adapter, 'create');
    const targetSpy = vi.spyOn(executionStack.target, 'create');
    const extensionSpies = executionStack.extensionPacks.map((ext) => vi.spyOn(ext, 'create'));
    const tables = db.schema.tables;

    db.sql.from(tables.user).select({ id: tables.user.columns.id }).limit(1).build();

    expect(targetSpy).not.toHaveBeenCalled();
    expect(adapterSpy).not.toHaveBeenCalled();
    for (const spy of extensionSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
