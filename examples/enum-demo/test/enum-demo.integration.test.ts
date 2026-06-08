import { withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { contract } from '../src/contract';
import { createOrmClient, getRuntime, queries } from '../src/db';
import { initTestDatabase } from './init-db';

const seed = [
  { id: 'a', title: 'Ship it', priority: 'high' },
  { id: 'b', title: 'Sketch', priority: 'low' },
  { id: 'c', title: 'Polish', priority: 'medium' },
  { id: 'd', title: 'Draft', priority: 'low' },
] as const;

describe('enum-demo: enum-typed field end to end', () => {
  it('db.enums exposes the declaration-ordered runtime surface', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      await initTestDatabase({ connection: connectionString, contract });
      const { runtime, close } = await getRuntime(connectionString);
      try {
        const db = createOrmClient(runtime);

        expect(db.enums.Priority.values).toEqual(['low', 'high', 'medium']);
        expect(db.enums.Priority.names).toEqual(['Low', 'High', 'Medium']);
        expect(db.enums.Priority.members.Medium).toBe('medium');
        expect(db.enums.Priority.has('high')).toBe(true);
        expect(db.enums.Priority.has('urgent')).toBe(false);
        expect(db.enums.Priority.ordinalOf('medium')).toBe(2);
      } finally {
        await close();
      }
    });
  });

  it('ORDER BY on the enum column sorts by declaration order, not lexically', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      await initTestDatabase({ connection: connectionString, contract });
      const { runtime, close } = await getRuntime(connectionString);
      try {
        await runtime.execute(queries.task.insert([...seed]).build());

        const ordered = await runtime.execute(
          queries.task.select('id', 'priority').orderBy('priority').orderBy('id').build(),
        );

        // Declaration order is low -> high -> medium; lexical would be high, low, medium.
        expect(ordered.map((row) => row.priority)).toEqual(['low', 'low', 'high', 'medium']);
        expect(ordered.map((row) => row.id)).toEqual(['b', 'd', 'a', 'c']);
      } finally {
        await close();
      }
    });
  });

  it('the enum CHECK constraint (slice 2) rejects out-of-union values', async () => {
    await withDevDatabase(async ({ connectionString }) => {
      await initTestDatabase({ connection: connectionString, contract });
      const { runtime, close } = await getRuntime(connectionString);
      try {
        await expect(
          runtime.execute(
            queries.task.insert([{ id: 'x', title: 'Bad', priority: 'urgent' as 'low' }]).build(),
          ),
        ).rejects.toThrow();
      } finally {
        await close();
      }
    });
  });
});
