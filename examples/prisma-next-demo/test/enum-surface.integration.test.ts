import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { createRuntime, type Runtime } from '@prisma-next/sql-runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { contract } from '../prisma/contract';
import { context, sql, stack } from '../src/prisma-no-emit/context';
import { getPostsByPriority, getPriorityEnum } from '../src/prisma-no-emit/priority-feed';
import { initTestDatabase } from './utils/control-client';

const authorId = '00000000-0000-0000-0000-000000000001';

// Posts whose `Priority` enum values are deliberately out of declaration order
// so the ORDER BY assertion below is meaningful. Post ids are uuids so the
// secondary sort key is stable.
const seed = [
  {
    id: '10000000-0000-0000-0000-00000000000a',
    title: 'Ship it',
    userId: authorId,
    priority: 'high',
  },
  {
    id: '10000000-0000-0000-0000-00000000000b',
    title: 'Sketch',
    userId: authorId,
    priority: 'low',
  },
  {
    id: '10000000-0000-0000-0000-00000000000c',
    title: 'Polish',
    userId: authorId,
    priority: 'urgent',
  },
  { id: '10000000-0000-0000-0000-00000000000d', title: 'Draft', userId: authorId, priority: 'low' },
] as const;

async function openRuntime(
  connectionString: string,
): Promise<{ runtime: Runtime; close: () => Promise<void> }> {
  const pool = new Pool({ connectionString });
  const stackInstance = instantiateExecutionStack(stack);
  const driver = stackInstance.driver;
  if (!driver) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  try {
    await driver.connect({ kind: 'pgPool', pool });
  } catch (error) {
    await pool.end();
    throw error;
  }
  const runtime = createRuntime({ stackInstance, context, driver });
  return { runtime, close: () => pool.end() };
}

describe('TS-authored enum on the demo contract (Post.priority)', () => {
  it(
    'db.enums exposes the declaration-ordered runtime surface',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const { runtime, close } = await openRuntime(connectionString);
        try {
          const priority = getPriorityEnum(runtime);
          expect(priority.values).toEqual(['low', 'high', 'urgent']);
          expect(priority.names).toEqual(['Low', 'High', 'Urgent']);
          expect(priority.members.Urgent).toBe('urgent');
          expect(priority.has('high')).toBe(true);
          const notAMember = 'nope' as 'low' | 'high' | 'urgent';
          expect(priority.has(notAMember)).toBe(false);
          expect(priority.ordinalOf('urgent')).toBe(2);
        } finally {
          await close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reading Post.priority narrows to the value union and sorts by declaration order',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const { runtime, close } = await openRuntime(connectionString);
        try {
          await runtime.execute(
            sql.user.insert([{ id: authorId, email: 'author@example.com', kind: 'user' }]).build(),
          );
          await runtime.execute(sql.post.insert([...seed]).build());

          const ordered = await getPostsByPriority(runtime);

          // The read narrows to the value union, not string: assigning each
          // row's priority into the union typechecks without a cast.
          const unions: Array<'low' | 'high' | 'urgent'> = ordered.map((row) => row.priority);

          // Declaration order is low -> high -> urgent; lexical would be
          // high, low, low, urgent.
          expect(unions).toEqual(['low', 'low', 'high', 'urgent']);
          expect(ordered.map((row) => row.id)).toEqual([
            '10000000-0000-0000-0000-00000000000b',
            '10000000-0000-0000-0000-00000000000d',
            '10000000-0000-0000-0000-00000000000a',
            '10000000-0000-0000-0000-00000000000c',
          ]);
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
        await initTestDatabase({ connection: connectionString, contract });
        const { runtime, close } = await openRuntime(connectionString);
        try {
          await runtime.execute(
            sql.user.insert([{ id: authorId, email: 'author@example.com', kind: 'user' }]).build(),
          );
          await expect(
            runtime.execute(
              sql.post
                .insert([
                  {
                    id: '10000000-0000-0000-0000-0000000000ff',
                    title: 'Bad',
                    userId: authorId,
                    priority: 'nope' as 'low',
                  },
                ])
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
