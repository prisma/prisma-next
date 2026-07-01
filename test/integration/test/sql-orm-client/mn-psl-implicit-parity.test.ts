// Runtime parity for an implicit many-to-many authored as two bare navigable
// list ends with NO junction model.
//
// `mn-psl-through-parity.test.ts` drives an M:N whose junction (`UserTag`) is an
// authored model. This file drives the `mn-psl-implicit` fixture, where
// `Post.tags Tag[]` / `Tag.posts Post[]` are both bare and no model links the
// pair, so the interpreter synthesises a model-less junction `_PostToTag`
// (composite PK `(A, B)`, FK `A` → `posts.id`, FK `B` → `tags.id`) and lowers
// both ends to `cardinality: 'N:M'` + `through` over it. The ORM `include` walks
// the synthesised junction exactly like an authored one — so an implicit M:N
// drives `include` end-to-end through a real emitted PSL contract with no
// authored junction model.
//
// The synthesised `_PostToTag` table is mixed-case, so the raw schema setup
// quotes it (an unquoted identifier folds to lowercase in postgres); the runtime
// references it quoted via the `through` descriptor.
//
// Deserializing the emitted JSON runs the full sql contract validation pipeline,
// so a contract that failed to round-trip validation would throw at module load.
//
// Standard:
//   1. Whole-row toEqual assertions on every test.
//   2. Explicit .select() in most tests; one implicit-selection readback.

import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import pgvectorRuntime from '@prisma-next/extension-pgvector/runtime';
import { Collection } from '@prisma-next/sql-orm-client';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import type { Contract as MnPslImplicitContract } from './fixtures/mn-psl-implicit/generated/contract';
import mnPslImplicitContractJson from './fixtures/mn-psl-implicit/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const TAG_RUST = 'tag-rust';
const TAG_TS = 'tag-typescript';

const mnPslImplicitContract = new PostgresContractSerializer().deserializeContract(
  mnPslImplicitContractJson,
) as MnPslImplicitContract;

const mnPslImplicitContext: ExecutionContext<MnPslImplicitContract> = createExecutionContext({
  contract: mnPslImplicitContract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensionPacks: [pgvectorRuntime],
  }),
});

function createPostsCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: mnPslImplicitContext }, 'Post', {
    namespaceId: 'public',
  });
}

// The implicit `posts` / `tags` / `_PostToTag` schema is not part of
// setupTestSchema, so build it directly. The synthesised junction is mixed-case
// and must be quoted to match the contract's table name.
async function createImplicitMnSchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists "_PostToTag"');
  await runtime.query('drop table if exists posts');
  await runtime.query('drop table if exists tags');
  await runtime.query(`
    create table posts (
      id integer primary key,
      title text not null
    )
  `);
  await runtime.query(`
    create table tags (
      id text primary key,
      label text not null unique
    )
  `);
  await runtime.query(`
    create table "_PostToTag" (
      "A" integer not null references posts (id),
      "B" text not null references tags (id),
      primary key ("A", "B")
    )
  `);
}

async function seedPosts(
  runtime: PgIntegrationRuntime,
  posts: readonly { id: number; title: string }[],
): Promise<void> {
  for (const post of posts) {
    await runtime.query('insert into posts (id, title) values ($1, $2)', [post.id, post.title]);
  }
}

async function seedTags(
  runtime: PgIntegrationRuntime,
  tags: readonly { id: string; label: string }[],
): Promise<void> {
  for (const tag of tags) {
    await runtime.query('insert into tags (id, label) values ($1, $2)', [tag.id, tag.label]);
  }
}

async function seedPostTags(
  runtime: PgIntegrationRuntime,
  postTags: readonly { postId: number; tagId: string }[],
): Promise<void> {
  for (const pt of postTags) {
    await runtime.query('insert into "_PostToTag" ("A", "B") values ($1, $2)', [
      pt.postId,
      pt.tagId,
    ]);
  }
}

describe('integration/mn-psl-implicit-parity', () => {
  it(
    'include("tags") with explicit select returns selected fields on post and tags (whole-row toEqual)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await createImplicitMnSchema(runtime);

        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [
          { id: 1, title: 'Intro to Rust' },
          { id: 2, title: 'Intro to TypeScript' },
        ]);
        await seedTags(runtime, [
          { id: TAG_RUST, label: 'Rust' },
          { id: TAG_TS, label: 'TypeScript' },
        ]);
        await seedPostTags(runtime, [
          { postId: 1, tagId: TAG_RUST },
          { postId: 1, tagId: TAG_TS },
          { postId: 2, tagId: TAG_TS },
        ]);

        const rows = await posts
          .select('id', 'title')
          .orderBy((p) => p.id.asc())
          .include('tags', (tags) => tags.select('id', 'label').orderBy((t) => t.label.asc()))
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            title: 'Intro to Rust',
            tags: [
              { id: TAG_RUST, label: 'Rust' },
              { id: TAG_TS, label: 'TypeScript' },
            ],
          },
          {
            id: 2,
            title: 'Intro to TypeScript',
            tags: [{ id: TAG_TS, label: 'TypeScript' }],
          },
        ]);
      }, mnPslImplicitContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include("tags") with no .select returns the full default row shape (implicit selection)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await createImplicitMnSchema(runtime);

        const posts = createPostsCollection(runtime);

        await seedPosts(runtime, [{ id: 1, title: 'Intro to Rust' }]);
        await seedTags(runtime, [
          { id: TAG_RUST, label: 'Rust' },
          { id: TAG_TS, label: 'TypeScript' },
        ]);
        await seedPostTags(runtime, [
          { postId: 1, tagId: TAG_RUST },
          { postId: 1, tagId: TAG_TS },
        ]);

        const rows = await posts
          .orderBy((p) => p.id.asc())
          .include('tags', (tags) => tags.orderBy((t) => t.label.asc()))
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            title: 'Intro to Rust',
            tags: [
              { id: TAG_RUST, label: 'Rust' },
              { id: TAG_TS, label: 'TypeScript' },
            ],
          },
        ]);
      }, mnPslImplicitContext.contract);
    },
    timeouts.spinUpPpgDev,
  );
});
