import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoSchema, demoSql, demoStack } from '../src/prisma/context';

describe('static context (no runtime)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('can build query plans from static context', () => {
    const tables = demoSchema.tables;
    const plan = demoSql.from(tables.user).select({ id: tables.user.columns.id }).limit(1).build();

    expect(plan).toMatchObject({
      ast: { kind: 'select' },
      meta: { lane: 'dsl' },
    });
  });

  it('importing query roots does not instantiate adapter or extensions', () => {
    const executionStack = demoStack;
    const adapterSpy = vi.spyOn(executionStack.adapter, 'create');
    const targetSpy = vi.spyOn(executionStack.target, 'create');
    const extensionSpies = executionStack.extensionPacks.map((ext) => vi.spyOn(ext, 'create'));
    const tables = demoSchema.tables;

    demoSql.from(tables.user).select({ id: tables.user.columns.id }).limit(1).build();

    expect(targetSpy).not.toHaveBeenCalled();
    expect(adapterSpy).not.toHaveBeenCalled();
    for (const spy of extensionSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
