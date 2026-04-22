/**
 * Integration tests for the SQL DSL as a standalone query surface.
 *
 * These tests validate that the SQL DSL can express and execute queries the ORM
 * client cannot — fulfilling the "escape hatch" role described in TML-2160 and
 * VP1 of the Runtime pipeline project.
 */

import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { SqlDriver } from '@prisma-next/sql-relational-core/ast';
import { type CreateRuntimeOptions, createRuntime, type Runtime } from '@prisma-next/sql-runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { db } from '../src/prisma/db';
import { crossAuthorSimilarity } from '../src/queries/cross-author-similarity';
import { initTestDatabase } from './utils/control-client';

const context = db.context;
const { contract } = context;
const executionStack = db.stack;

async function createTestDriver(connectionString: string) {
  const stackInstance = instantiateExecutionStack(
    executionStack,
  ) as CreateRuntimeOptions['stackInstance'];
  const driver = stackInstance.driver as unknown as SqlDriver<unknown>;
  if (!driver) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  const pool = new Pool({ connectionString });
  try {
    await driver.connect({ kind: 'pgPool', pool });
  } catch (error) {
    await pool.end();
    throw error;
  }
  return { stackInstance, driver };
}

async function getRuntime(connectionString: string): Promise<Runtime> {
  const { stackInstance, driver } = await createTestDriver(connectionString);
  return createRuntime({
    stackInstance,
    context,
    driver,
    verify: { mode: 'onFirstUse', requireMarker: false },
  });
}

const seededUserIds = {
  alice: '30000000-0000-0000-0000-000000000001',
  bob: '30000000-0000-0000-0000-000000000002',
  carol: '30000000-0000-0000-0000-000000000003',
} as const;

const seededPostIds = {
  aliceClose: '40000000-0000-0000-0000-000000000001',
  aliceFar: '40000000-0000-0000-0000-000000000002',
  bobClose: '40000000-0000-0000-0000-000000000003',
  bobMid: '40000000-0000-0000-0000-000000000004',
  bobFar: '40000000-0000-0000-0000-000000000005',
  carolUnembedded: '40000000-0000-0000-0000-000000000006',
} as const;

function makeVector(leadingValues: number[]): number[] {
  const vec = new Array<number>(1536).fill(0);
  for (let i = 0; i < leadingValues.length; i++) {
    vec[i] = leadingValues[i]!;
  }
  return vec;
}

function unorderedPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

async function seedCrossAuthorSimilarity(runtime: Runtime): Promise<void> {
  const builder = sql({ context });

  const users = [
    {
      id: seededUserIds.alice,
      email: 'alice@example.com',
      displayName: 'Alice',
      createdAt: new Date('2024-03-01T00:00:00.000Z'),
      kind: 'admin' as const,
    },
    {
      id: seededUserIds.bob,
      email: 'bob@example.com',
      displayName: 'Bob',
      createdAt: new Date('2024-03-02T00:00:00.000Z'),
      kind: 'user' as const,
    },
    {
      id: seededUserIds.carol,
      email: 'carol@example.com',
      displayName: 'Carol',
      createdAt: new Date('2024-03-03T00:00:00.000Z'),
      kind: 'user' as const,
    },
  ];

  for (const user of users) {
    await runtime.execute(builder.user.insert(user).build());
  }

  // Alice's aliceFar [0.7,0.3,0] and Bob's bobClose [0.5,0.5,0] are the closest
  // cross-author pair (cosine distance ≈ 0.0715). Alice's aliceClose [1,0,0] vs
  // bobClose is second closest (≈ 0.2929). Carol has no embedded post and must
  // never appear in a cross-author pair.
  const posts = [
    {
      id: seededPostIds.aliceClose,
      title: 'Alice close',
      userId: seededUserIds.alice,
      createdAt: new Date('2024-03-10T10:00:00.000Z'),
      embedding: makeVector([1, 0, 0]),
    },
    {
      id: seededPostIds.aliceFar,
      title: 'Alice far',
      userId: seededUserIds.alice,
      createdAt: new Date('2024-03-11T10:00:00.000Z'),
      embedding: makeVector([0.7, 0.3, 0]),
    },
    {
      id: seededPostIds.bobClose,
      title: 'Bob close',
      userId: seededUserIds.bob,
      createdAt: new Date('2024-03-12T10:00:00.000Z'),
      embedding: makeVector([0.5, 0.5, 0]),
    },
    {
      id: seededPostIds.bobMid,
      title: 'Bob mid',
      userId: seededUserIds.bob,
      createdAt: new Date('2024-03-13T10:00:00.000Z'),
      embedding: makeVector([0, 1, 0]),
    },
    {
      id: seededPostIds.bobFar,
      title: 'Bob far',
      userId: seededUserIds.bob,
      createdAt: new Date('2024-03-14T10:00:00.000Z'),
      embedding: makeVector([-1, 0, 0]),
    },
    {
      id: seededPostIds.carolUnembedded,
      title: 'Carol unembedded',
      userId: seededUserIds.carol,
      createdAt: new Date('2024-03-15T10:00:00.000Z'),
    },
  ];

  for (const post of posts) {
    await runtime.execute(builder.post.insert(post).build());
  }
}

describe('SQL DSL standalone query execution (TML-2160)', () => {
  it(
    'crossAuthorSimilarity returns closest cross-author pairs ordered by cosine distance',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedCrossAuthorSimilarity(runtime);

          const results = await crossAuthorSimilarity(20, runtime);

          // Every returned row is a cross-author pair: authors must differ.
          expect(results.every((row) => row.postAUserId !== row.postBUserId)).toBe(true);

          // Carol has no embedded post, so she must not appear on either side.
          expect(
            results.every(
              (row) =>
                row.postAUserId !== seededUserIds.carol && row.postBUserId !== seededUserIds.carol,
            ),
          ).toBe(true);

          // Distances are non-negative and non-decreasing (ORDER BY distance ASC).
          for (const row of results) {
            expect(row.distance).toBeGreaterThanOrEqual(0);
          }
          for (let i = 1; i < results.length; i++) {
            expect(results[i]!.distance).toBeGreaterThanOrEqual(results[i - 1]!.distance);
          }

          // The closest unordered pair is aliceFar × bobClose. It appears in both
          // orderings (p1=alice/p2=bob and p1=bob/p2=alice), so the top-2 rows
          // should be those two permutations of the same unordered pair.
          const topTwo = results.slice(0, 2);
          const topPairKeys = new Set(
            topTwo.map((row) => unorderedPairKey(row.postAId, row.postBId)),
          );
          expect(topPairKeys.size).toBe(1);
          expect(
            topPairKeys.has(unorderedPairKey(seededPostIds.aliceFar, seededPostIds.bobClose)),
          ).toBe(true);
          expect(topTwo[0]!.distance).toBeLessThan(0.1);
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'crossAuthorSimilarity respects the limit argument',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await initTestDatabase({ connection: connectionString, contract });
        const runtime = await getRuntime(connectionString);

        try {
          await seedCrossAuthorSimilarity(runtime);

          const limited = await crossAuthorSimilarity(1, runtime);

          expect(limited).toHaveLength(1);
          const [row] = limited;
          if (!row) throw new Error('expected one row');
          expect(row.postAUserId).not.toBe(row.postBUserId);
          expect(unorderedPairKey(row.postAId, row.postBId)).toBe(
            unorderedPairKey(seededPostIds.aliceFar, seededPostIds.bobClose),
          );
        } finally {
          await runtime.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
