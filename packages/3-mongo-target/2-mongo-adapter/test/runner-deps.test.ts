import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import { extractDb } from '../src/core/runner-deps';

describe('extractDb', () => {
  it('returns the db reference attached to the mongo control driver', () => {
    const fakeDb = { __id: 'fake-db' } as unknown;
    const driver = {
      familyId: 'mongo',
      targetId: 'mongo',
      db: fakeDb,
      execute: () => {
        throw new Error('not used');
      },
      close: async () => {},
    } as unknown as ControlDriverInstance<'mongo', 'mongo'>;
    expect(extractDb(driver)).toBe(fakeDb);
  });

  it('throws when the value is not a Mongo control driver', () => {
    const driver = {} as unknown as ControlDriverInstance<'mongo', 'mongo'>;
    expect(() => extractDb(driver)).toThrowError(/Expected a Mongo control driver/);
  });
});
