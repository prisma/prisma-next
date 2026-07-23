import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/issues-18598-select-count-true/generated/contract';
import contractJson from '../../_fixtures/issues-18598-select-count-true/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/18598-select-count-true
// (postgres matrix entry).
//
// Subject: `select: { _count: true }` shorthand returns counts of all related models.
// Upstream: `prisma.user.findFirst({ select: { _count: true } })` → `{ _count: { posts: 2 } }`
//
// API-shape translation:
//   `select: { _count: true }` → `include('posts', p => p.count())`
//   `user._count.posts` (Prisma nested) → `user.posts` (prisma-next flat include scalar)
//
// The underlying behaviour (count of related posts is 2) is the same;
// only the nesting shape differs — this is API-shape translation.

function withIssue18598(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-18598-select-count-true', () => {
  it(
    'works with _count shorthand',
    () =>
      withIssue18598(async ({ db }) => {
        const { id } = await db.public.User.create({});
        await db.public.Post.create({ userId: id });
        await db.public.Post.create({ userId: id });

        const user = await db.public.User.where({ id })
          .include('posts', (p) => p.count())
          .first();

        expect(user?.posts).toEqual(2);
      }),
    timeouts.spinUpPpgDev,
  );
});
