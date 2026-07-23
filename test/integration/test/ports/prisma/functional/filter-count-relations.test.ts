import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/filter-count-relations/generated/contract';
import contractJson from '../../_fixtures/filter-count-relations/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPostgresPort } from '../../_harness/postgres';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/filter-count-relations
// (postgres matrix entry).
//
// Upstream uses an implicit M2M between User and Group. prisma-next requires
// an explicit junction model (UserGroup). The fixture adds bare backrelation
// list fields (`groups Group[]` on User, `users User[]` on Group) so the
// interpreter lowers them with cardinality 'N:M' and a `through` descriptor,
// enabling the nested-relation include to traverse directly to User rows.
//
// API translation:
//   `prisma.user.findFirst({ select: { _count: { select: { posts: true } } } })`
//   → `db.public.User.where({email}).include('posts', p => p.count()).first()`
//   The include scalar result is named `posts` on the returned row alongside scalar fields.
//
//   `prisma.group.findFirst({ select: { users: { select: { _count: ... }, orderBy: { id: 'asc' } } } })`
//   → `db.public.Group.where({title}).include('users', u => u.orderBy(x=>x.id.asc()).select('id').include('posts', p => p.where({published:true}).count())).first()`
//
// M2M filtered-count cases (`group._count.users where ...`) compile but hit a
// query-plan bug: N:M include count() does not route through the junction;
// buildIncludeChildScalarSelect ignores the `through` descriptor and emits
// a direct column ref (`user.groupId`) that does not exist on the user table.
// These are marked it.fails.

const GROUP_TITLE = 'test-group';
const USER_EMAIL = 'target@example.com';

function withFilterCountRelations(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    const group = await ctx.db.public.Group.create({ id: 'g1', title: GROUP_TITLE });

    await ctx.db.public.User.create({
      id: 'u1',
      email: 'user1@example.com',
      blocked: true,
      balance: 50,
    });
    await ctx.db.public.UserGroup.create({ userId: 'u1', groupId: group.id });

    await ctx.db.public.User.create({ id: 'u2', email: 'user2@example.com', balance: 10 });
    await ctx.db.public.UserGroup.create({ userId: 'u2', groupId: group.id });

    await ctx.db.public.User.create({ id: 'u3', email: USER_EMAIL, balance: 70 });
    await ctx.db.public.UserGroup.create({ userId: 'u3', groupId: group.id });

    await ctx.db.public.Post.create({ id: 'p1', published: true, upvotes: 10, authorId: 'u3' });
    await ctx.db.public.Post.create({ id: 'p2', published: true, upvotes: 150, authorId: 'u3' });
    await ctx.db.public.Post.create({ id: 'p3', published: false, upvotes: 120, authorId: 'u3' });
    await ctx.db.public.Post.create({ id: 'p4', published: true, upvotes: 15, authorId: 'u3' });

    await fn(ctx);
  });
}

describe('ports/prisma/functional/filter-count-relations', () => {
  it(
    'without condition',
    () =>
      withFilterCountRelations(async ({ db }) => {
        const user = await db.public.User.where({ email: USER_EMAIL })
          .include('posts', (p) => p.count())
          .first();

        expect(user?.posts).toBe(4);
      }),
    timeouts.spinUpPpgDev,
  );

  describe('one-to-many', () => {
    it(
      'with simple equality condition',
      () =>
        withFilterCountRelations(async ({ db }) => {
          const user = await db.public.User.where({ email: USER_EMAIL })
            .include('posts', (p) => p.where({ published: true }).count())
            .first();

          expect(user?.posts).toBe(3);
        }),
      timeouts.spinUpPpgDev,
    );

    it(
      'with > condition',
      () =>
        withFilterCountRelations(async ({ db }) => {
          const user = await db.public.User.where({ email: USER_EMAIL })
            .include('posts', (p) => p.where((post) => post.upvotes.gt(100)).count())
            .first();

          expect(user?.posts).toBe(2);
        }),
      timeouts.spinUpPpgDev,
    );

    it(
      'with multiple conditions',
      () =>
        withFilterCountRelations(async ({ db }) => {
          const user = await db.public.User.where({ email: USER_EMAIL })
            .include('posts', (p) =>
              p
                .where({ published: true })
                .where((post) => post.upvotes.gt(100))
                .count(),
            )
            .first();

          expect(user?.posts).toBe(1);
        }),
      timeouts.spinUpPpgDev,
    );
  });

  describe('many-to-many', () => {
    // Upstream: group.findFirst({ where: { title }, select: {
    //   users: { select: { _count: { select: { posts: { where: { published: true } } } } },
    //            orderBy: { id: 'asc' } } } })
    // → [{ _count: { posts: 0 } }, { _count: { posts: 0 } }, { _count: { posts: 3 } }]
    //
    // Faithful port: traverse the N:M relation from Group to User (via UserGroup junction),
    // orderBy id asc, then nested include of posts filtered by published:true, count().
    // The users N:M relation resolves through the junction to User rows directly.
    // Upstream returns user objects with _count.posts; we assert the equivalent
    // flat count field on each user (posts count value from include.count()).
    it(
      'nested relation',
      () =>
        withFilterCountRelations(async ({ db }) => {
          const group = await db.public.Group.where({ title: GROUP_TITLE })
            .include('users', (u) =>
              u
                .orderBy((x) => x.id.asc())
                .select('id')
                .include('posts', (p) => p.where({ published: true }).count()),
            )
            .first();

          // Upstream: [{ _count: { posts: 0 } }, { _count: { posts: 0 } }, { _count: { posts: 3 } }]
          // prisma-next flattens _count.posts → posts on each user row.
          expect(group?.users.map((u) => u.posts)).toEqual([0, 0, 3]);
        }),
      timeouts.spinUpPpgDev,
    );

    // Upstream: group.findFirst({ where: { title }, select: {
    //   _count: { select: { users: { where: { blocked: true } } } } } }) → 1
    //
    // Faithful port: include('users', u => u.where({blocked:true}).count()).
    // This compiles but hits a query-plan bug: N:M include count() does not
    // route through the junction; buildIncludeChildScalarSelect ignores `through`
    // and emits `user.groupId = group.id` (column does not exist on user table).
    it.fails(
      'with simple equality condition',
      () =>
        withFilterCountRelations(async ({ db }) => {
          const group = await db.public.Group.where({ title: GROUP_TITLE })
            .include('users', (u) => u.where({ blocked: true }).count())
            .first();

          expect(group?.users).toBe(1);
        }),
      timeouts.spinUpPpgDev,
    );

    // Upstream: group.findFirst({ where: { title }, select: {
    //   _count: { select: { users: { where: { balance: { gt: 20 } } } } } } }) → 2
    it.fails(
      'with > condition',
      () =>
        withFilterCountRelations(async ({ db }) => {
          const group = await db.public.Group.where({ title: GROUP_TITLE })
            .include('users', (u) => u.where((user) => user.balance.gt(20)).count())
            .first();

          expect(group?.users).toBe(2);
        }),
      timeouts.spinUpPpgDev,
    );

    // Upstream: group.findFirst({ where: { title }, select: {
    //   _count: { select: { users: { where: { balance: { gt: 20 }, blocked: false } } } } } }) → 1
    it.fails(
      'with multiple conditions',
      () =>
        withFilterCountRelations(async ({ db }) => {
          const group = await db.public.Group.where({ title: GROUP_TITLE })
            .include('users', (u) =>
              u
                .where({ blocked: false })
                .where((user) => user.balance.gt(20))
                .count(),
            )
            .first();

          expect(group?.users).toBe(1);
        }),
      timeouts.spinUpPpgDev,
    );
  });
});
