import { describe, expect, it, vi } from 'vitest';
import { executionStack, sql, tables } from '../src/prisma/context';

describe('static context (no runtime)', () => {
  it('can build query plans from static context', () => {
    const plan = sql.from(tables.user).select({ id: tables.user.columns.id }).limit(1).build();

    expect(plan).toMatchObject({
      ast: { kind: 'select' },
      meta: { lane: 'dsl' },
    });
  });

  it('importing query roots does not instantiate adapter or extensions', () => {
    // context.ts exports a descriptors-only stack — create() is never called.
    // Spy on the descriptor create methods and verify they stay untouched
    // while building query plans from the static context.
    const adapterSpy = vi.spyOn(executionStack.adapter, 'create');
    const targetSpy = vi.spyOn(executionStack.target, 'create');
    const extensionSpies = executionStack.extensionPacks.map((ext) => vi.spyOn(ext, 'create'));

    // Build a query plan — must NOT trigger any descriptor instantiation
    sql.from(tables.user).select({ id: tables.user.columns.id }).limit(1).build();

    expect(targetSpy).not.toHaveBeenCalled();
    expect(adapterSpy).not.toHaveBeenCalled();
    for (const spy of extensionSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
