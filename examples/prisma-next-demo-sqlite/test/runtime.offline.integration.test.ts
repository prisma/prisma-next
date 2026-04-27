import {
  IdentifierRef,
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
    const plan = db.sql.user.select('id', 'email').limit(1).build();

    expect(plan.ast).toBeInstanceOf(SelectAst);
    expect(plan.meta).toMatchObject({ lane: 'dsl', target: 'sqlite' });

    const ast = plan.ast as SelectAst;
    expect(ast.from).toBeInstanceOf(TableSource);
    expect((ast.from as TableSource).name).toBe('user');
    expect(ast.limit).toBe(1);
    expect(ast.projection).toHaveLength(2);
    expect(ast.projection[0]).toEqual(ProjectionItem.of('id', IdentifierRef.of('id')));
    expect(ast.projection[1]).toEqual(ProjectionItem.of('email', IdentifierRef.of('email')));
  });

  it('building query plans does not instantiate adapter, target, or extensions', () => {
    const executionStack = db.stack;
    const adapterSpy = vi.spyOn(executionStack.adapter, 'create');
    const targetSpy = vi.spyOn(executionStack.target, 'create');
    const extensionSpies = executionStack.extensionPacks.map((ext) => vi.spyOn(ext, 'create'));

    db.sql.user.select('id', 'email').limit(1).build();

    expect(targetSpy).not.toHaveBeenCalled();
    expect(adapterSpy).not.toHaveBeenCalled();
    for (const spy of extensionSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
