// Ported engine filter/relation behaviours (ledger entries 21–40) exercised
// end-to-end against a real database through the ORM `Collection` surface.
//
// Covered:
//   - null semantics (21–24): isNull / isNotNull / eq(null) / neq(null)
//   - boolean combinators (25–31): and / or / not / not(not) / all / nested /
//     chained .where
//   - one-to-many relation predicates (32–40): some / every / none on
//     User.posts and Post.comments, including two-level nesting
//
// Standard (project rule sql-orm-client-whole-shape-assertions): assert the
// whole result shape with toEqual — full User rows
// `{ id, name, email, invitedById, address }` and full Post rows
// `{ id, title, userId, views, embedding }` — since no `.select()` narrows them.

import { all, and, not, or } from '@prisma-next/sql-orm-client';
import { describe, expect, it } from 'vitest';
import {
  createPostsCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedComments, seedPosts, seedUsers } from './runtime-helpers';

describe('integration/ported-filters-relations', () => {
  // ===========================================================================
  // Null semantics (21–24)
  // ===========================================================================

  it(
    '21. isNull() matches only rows with a null invitedById',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2 },
        ]);

        const rows = await users
          .where((u) => u.invitedById.isNull())
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '22. isNotNull() matches only rows with a non-null invitedById',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2 },
        ]);

        const rows = await users
          .where((u) => u.invitedById.isNotNull())
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1, address: null },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1, address: null },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '23. eq(null) coerces to IS NULL at result level',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
        ]);

        const rows = await users.where((u) => u.invitedById.eq(null)).all();

        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '24. neq(null) coerces to IS NOT NULL at result level',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2 },
        ]);

        const rows = await users
          .where((u) => u.invitedById.neq(null))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1, address: null },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1, address: null },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Boolean combinators (25–31)
  // ===========================================================================

  it(
    '25. and(...) of two field predicates yields the intersection',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Paul', email: 'paul@example.com' },
          { id: 3, name: 'Peter', email: 'peter@example.com' },
          { id: 4, name: 'Pam', email: 'pam@example.com' },
        ]);

        const rows = await users
          .where((u) => and(u.name.like('P%'), u.id.gt(2)))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 3, name: 'Peter', email: 'peter@example.com', invitedById: null, address: null },
          { id: 4, name: 'Pam', email: 'pam@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '26. or(...) of two field predicates yields the union',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Paul', email: 'paul@example.com' },
          { id: 3, name: 'Peter', email: 'peter@example.com' },
          { id: 4, name: 'Pam', email: 'pam@example.com' },
        ]);

        const rows = await users
          .where((u) => or(u.id.gt(2), u.name.like('P%')))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 2, name: 'Paul', email: 'paul@example.com', invitedById: null, address: null },
          { id: 3, name: 'Peter', email: 'peter@example.com', invitedById: null, address: null },
          { id: 4, name: 'Pam', email: 'pam@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '27. not(...) negates a field predicate',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Paul', email: 'paul@example.com' },
          { id: 3, name: 'Peter', email: 'peter@example.com' },
          { id: 4, name: 'Pam', email: 'pam@example.com' },
        ]);

        const rows = await users
          .where((u) => not(u.name.like('P%')))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '28. double not(not(...)) is identity',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Paul', email: 'paul@example.com' },
          { id: 3, name: 'Peter', email: 'peter@example.com' },
          { id: 4, name: 'Pam', email: 'pam@example.com' },
        ]);

        const rows = await users
          .where((u) => not(not(u.name.like('P%'))))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 2, name: 'Paul', email: 'paul@example.com', invitedById: null, address: null },
          { id: 3, name: 'Peter', email: 'peter@example.com', invitedById: null, address: null },
          { id: 4, name: 'Pam', email: 'pam@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '29. all() (empty AND) returns every row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Paul', email: 'paul@example.com' },
          { id: 3, name: 'Peter', email: 'peter@example.com' },
          { id: 4, name: 'Pam', email: 'pam@example.com' },
        ]);

        const rows = await users
          .where(all())
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
          { id: 2, name: 'Paul', email: 'paul@example.com', invitedById: null, address: null },
          { id: 3, name: 'Peter', email: 'peter@example.com', invitedById: null, address: null },
          { id: 4, name: 'Pam', email: 'pam@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '30. nested and/or tree combined with field predicates',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'foo one', userId: null, views: 3 },
          { id: 2, title: 'bar two', userId: null, views: 5 },
          { id: 3, title: 'foo three', userId: null, views: 1 },
          { id: 4, title: 'bar four', userId: null, views: 2 },
          { id: 5, title: 'baz five', userId: null, views: 4 },
        ]);

        const rows = await posts
          .where((p) => and(p.views.gte(2), or(p.title.like('foo%'), p.id.eq(5))))
          .orderBy((p) => p.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, title: 'foo one', userId: null, views: 3, embedding: null },
          { id: 5, title: 'baz five', userId: null, views: 4, embedding: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '31. multiple chained .where(...) calls AND together',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'p1', userId: null, views: 1 },
          { id: 2, title: 'p2', userId: null, views: 2 },
          { id: 3, title: 'p3', userId: null, views: 3 },
          { id: 4, title: 'p4', userId: null, views: 4 },
        ]);

        const rows = await posts
          .where((p) => p.views.gt(1))
          .where((p) => p.views.lt(4))
          .orderBy((p) => p.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 2, title: 'p2', userId: null, views: 2, embedding: null },
          { id: 3, title: 'p3', userId: null, views: 3, embedding: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // One-to-many relation predicates (32–36) — User.posts
  // ===========================================================================
  //
  // Shared shape for 32–36:
  //   Alice(1): posts views 5, 3
  //   Bob(2):   posts views 2, 4
  //   Cara(3):  no posts

  it(
    '32. some(pred) selects parents with a matching child',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 1, title: 'a1', userId: 1, views: 5 },
          { id: 2, title: 'a2', userId: 1, views: 3 },
          { id: 3, title: 'b1', userId: 2, views: 2 },
          { id: 4, title: 'b2', userId: 2, views: 4 },
        ]);

        const rows = await users
          .where((u) => u.posts.some((p) => p.views.gte(5)))
          .orderBy((u) => u.id.asc())
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '33. some() with no matching child returns no parents',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 1, title: 'a1', userId: 1, views: 5 },
          { id: 2, title: 'a2', userId: 1, views: 3 },
          { id: 3, title: 'b1', userId: 2, views: 2 },
          { id: 4, title: 'b2', userId: 2, views: 4 },
        ]);

        const rows = await users.where((u) => u.posts.some((p) => p.views.gte(50))).all();

        expect(rows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '34. every(pred) selects parents whose children all match (vacuous true for childless)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 1, title: 'a1', userId: 1, views: 5 },
          { id: 2, title: 'a2', userId: 1, views: 3 },
          { id: 3, title: 'b1', userId: 2, views: 2 },
          { id: 4, title: 'b2', userId: 2, views: 4 },
        ]);

        const rows = await users
          .where((u) => u.posts.every((p) => p.views.gte(3)))
          .orderBy((u) => u.id.asc())
          .all();

        // Alice: 5,3 all ≥ 3 → qualifies. Bob: 2 fails → excluded.
        // Cara: no posts → vacuously true → qualifies.
        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '35. none(pred) selects parents with no matching child',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 1, title: 'a1', userId: 1, views: 5 },
          { id: 2, title: 'a2', userId: 1, views: 3 },
          { id: 3, title: 'b1', userId: 2, views: 2 },
          { id: 4, title: 'b2', userId: 2, views: 4 },
        ]);

        const rows = await users
          .where((u) => u.posts.none((p) => p.views.gte(50)))
          .orderBy((u) => u.id.asc())
          .all();

        // No post crosses 50 → every user qualifies (childless Cara included).
        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null, address: null },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '36. some(pred) where the predicate is an AND of two child fields',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 1, title: 'a1', userId: 1, views: 5 },
          { id: 2, title: 'a2', userId: 1, views: 3 },
          { id: 3, title: 'b1', userId: 2, views: 2 },
          { id: 4, title: 'b2', userId: 2, views: 4 },
        ]);

        const rows = await users
          .where((u) => u.posts.some((p) => and(p.title.eq('a1'), p.views.gte(2))))
          .orderBy((u) => u.id.asc())
          .all();

        // Only Alice owns post 'a1' (views 5), satisfying both conjuncts.
        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Two-level nested relation predicates (37–39) — User.posts / Post.comments
  // ===========================================================================
  //
  // Shared shape for 37–39:
  //   Alice(1): P1 [comments x,y], P3 [comments x]
  //   Bob(2):   P2 [comments x,y], P4 [comments y]
  //   Cara(3):  no posts

  it(
    '37. two-level some/some relation filter',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 1, title: 'p1', userId: 1, views: 0 },
          { id: 2, title: 'p2', userId: 2, views: 0 },
          { id: 3, title: 'p3', userId: 1, views: 0 },
          { id: 4, title: 'p4', userId: 2, views: 0 },
        ]);
        await seedComments(runtime, [
          { id: 1, body: 'x', postId: 1 },
          { id: 2, body: 'y', postId: 1 },
          { id: 3, body: 'x', postId: 2 },
          { id: 4, body: 'y', postId: 2 },
          { id: 5, body: 'x', postId: 3 },
          { id: 6, body: 'y', postId: 4 },
        ]);

        const rows = await users
          .where((u) => u.posts.some((p) => p.comments.some((c) => c.body.eq('x'))))
          .orderBy((u) => u.id.asc())
          .all();

        // Alice (P1 has 'x') and Bob (P2 has 'x') both qualify; Cara has no posts.
        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '38. two-level some/every relation filter',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 1, title: 'p1', userId: 1, views: 0 },
          { id: 2, title: 'p2', userId: 2, views: 0 },
          { id: 3, title: 'p3', userId: 1, views: 0 },
          { id: 4, title: 'p4', userId: 2, views: 0 },
        ]);
        await seedComments(runtime, [
          { id: 1, body: 'x', postId: 1 },
          { id: 2, body: 'y', postId: 1 },
          { id: 3, body: 'x', postId: 2 },
          { id: 4, body: 'y', postId: 2 },
          { id: 5, body: 'x', postId: 3 },
          { id: 6, body: 'y', postId: 4 },
        ]);

        const rows = await users
          .where((u) => u.posts.some((p) => p.comments.every((c) => c.body.eq('x'))))
          .orderBy((u) => u.id.asc())
          .all();

        // Alice's P3 has only 'x' → every('x') holds for a post she owns → qualifies.
        // Bob owns no post whose comments are all 'x' (P2 mixed, P4 only 'y').
        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '39. two-level some/none relation filter',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 1, title: 'p1', userId: 1, views: 0 },
          { id: 2, title: 'p2', userId: 2, views: 0 },
          { id: 3, title: 'p3', userId: 1, views: 0 },
          { id: 4, title: 'p4', userId: 2, views: 0 },
        ]);
        await seedComments(runtime, [
          { id: 1, body: 'x', postId: 1 },
          { id: 2, body: 'y', postId: 1 },
          { id: 3, body: 'x', postId: 2 },
          { id: 4, body: 'y', postId: 2 },
          { id: 5, body: 'x', postId: 3 },
          { id: 6, body: 'y', postId: 4 },
        ]);

        const rows = await users
          .where((u) => u.posts.some((p) => p.comments.none((c) => c.body.eq('x'))))
          .orderBy((u) => u.id.asc())
          .all();

        // Bob's P4 has no 'x' comment → some(none('x')) holds. Alice's posts all
        // contain an 'x'; Cara has no posts.
        expect(rows).toEqual([
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    '40. AND of two independent some predicates on the same relation',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 1, title: 'post 1', userId: 1, views: 0 },
          { id: 2, title: 'post 2', userId: 1, views: 0 },
          { id: 3, title: 'post 1', userId: 2, views: 0 },
        ]);

        const rows = await users
          .where((u) =>
            and(
              u.posts.some((p) => p.title.eq('post 1')),
              u.posts.some((p) => p.title.eq('post 2')),
            ),
          )
          .orderBy((u) => u.id.asc())
          .all();

        // Alice owns both 'post 1' and 'post 2'; Bob owns only 'post 1'.
        expect(rows).toEqual([
          { id: 1, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
