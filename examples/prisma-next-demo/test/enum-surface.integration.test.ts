import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { enumContract } from '../prisma/enum-contract';
import { createEnumOrmClient, getEnumRuntime, queries } from '../prisma/enum-db';
import { initEnumTestDatabase } from './utils/enum-control-client';

const seed = [
  { id: 'a', title: 'Ship it', priority: 'high' },
  { id: 'b', title: 'Sketch', priority: 'low' },
  { id: 'c', title: 'Polish', priority: 'urgent' },
  { id: 'd', title: 'Draft', priority: 'low' },
] as const;

describe('TS-authored enum surfaces (enumType)', () => {
  it(
    'db.enums exposes the declaration-ordered runtime surface',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initEnumTestDatabase({ connection: connectionString, contract: enumContract });
        const { runtime, close } = await getEnumRuntime(connectionString);
        try {
          const db = createEnumOrmClient(runtime);

          expect(db.enums.Priority.values).toEqual(['low', 'high', 'urgent']);
          expect(db.enums.Priority.names).toEqual(['Low', 'High', 'Urgent']);
          expect(db.enums.Priority.members.Urgent).toBe('urgent');
          expect(db.enums.Priority.has('high')).toBe(true);
          expect(db.enums.Priority.has('nope')).toBe(false);
          expect(db.enums.Priority.ordinalOf('urgent')).toBe(2);
        } finally {
          await close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'ORDER BY on the enum column sorts by declaration order, not lexically',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initEnumTestDatabase({ connection: connectionString, contract: enumContract });
        const { runtime, close } = await getEnumRuntime(connectionString);
        try {
          await runtime.execute(queries.enum_task.insert([...seed]).build());

          const ordered = await runtime.execute(
            queries.enum_task.select('id', 'priority').orderBy('priority').orderBy('id').build(),
          );

          // Declaration order is low -> high -> urgent; lexical would be
          // high, low, urgent.
          expect(ordered.map((row) => row.priority)).toEqual(['low', 'low', 'high', 'urgent']);
          expect(ordered.map((row) => row.id)).toEqual(['b', 'd', 'a', 'c']);
        } finally {
          await close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'the enum CHECK constraint rejects out-of-union values written at runtime',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initEnumTestDatabase({ connection: connectionString, contract: enumContract });
        const { runtime, close } = await getEnumRuntime(connectionString);
        try {
          await expect(
            runtime.execute(
              queries.enum_task
                .insert([{ id: 'x', title: 'Bad', priority: 'nope' as 'low' }])
                .build(),
            ),
          ).rejects.toThrow();
        } finally {
          await close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );
});
