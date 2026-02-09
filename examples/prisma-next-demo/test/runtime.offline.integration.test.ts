import { afterEach, describe, expect, it, vi } from 'vitest';
import { executionStack, sql, tables } from '../src/prisma/context';

describe('static context (no runtime)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('can build query plans from static context', () => {
    const plan = sql.from(tables.user).select({ id: tables.user.columns.id }).limit(1).build();

    expect(plan).toMatchObject({
      ast: { kind: 'select' },
      meta: { lane: 'dsl' },
    });
  });

  it('importing query roots does not instantiate adapter or extensions', () => {
    const adapterSpy = vi.spyOn(executionStack.adapter, 'create');
    const targetSpy = vi.spyOn(executionStack.target, 'create');
    const extensionSpies = executionStack.extensionPacks.map((ext) => vi.spyOn(ext, 'create'));

    sql.from(tables.user).select({ id: tables.user.columns.id }).limit(1).build();

    expect(targetSpy).not.toHaveBeenCalled();
    expect(adapterSpy).not.toHaveBeenCalled();
    for (const spy of extensionSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
