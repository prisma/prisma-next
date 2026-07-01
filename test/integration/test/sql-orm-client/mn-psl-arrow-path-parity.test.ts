// Runtime parity for an M:N authored over a relation-field-less junction via
// the quoted arrow-path `through:` form.
//
// `mn-psl-through-parity.test.ts` drives an M:N whose junction (`UserTag`) is an
// authored model with `post`/`tag` relation fields; `mn-psl-implicit-parity.test.ts`
// drives one with no junction model at all. This file drives the
// `mn-psl-arrow-path` fixture: `PostTag` is an authored model carrying the
// scalar join columns `postId`/`tagId` + a composite `@@id`, but NO relation
// fields, so the navigable M:N is declared on the terminal models with the
// quoted arrow-path that names the join columns directly:
//
//   tags  Tag[]  @relation(through: "id -> PostTag.postId -> PostTag.tagId -> Tag.id")
//   posts Post[] @relation(through: "id -> PostTag.tagId -> PostTag.postId -> Post.id")
//
// The resolver builds the `through` descriptor straight from the named columns
// and lowers both ends to `cardinality: 'N:M'` + `through` over `post_tags` —
// the same runtime-consumable shape the authored-junction and implicit forms
// emit — so the column-based arrow-path drives the ORM `include` end-to-end
// through a real emitted PSL contract.
//
// The `posts` / `tags` / `post_tags` schema is not part of setupTestSchema, so
// build it directly.
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
import type { Contract as MnPslArrowPathContract } from './fixtures/mn-psl-arrow-path/generated/contract';
import mnPslArrowPathContractJson from './fixtures/mn-psl-arrow-path/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const TAG_RUST = 'tag-rust';
const TAG_TS = 'tag-typescript';

const mnPslArrowPathContract = new PostgresContractSerializer().deserializeContract(
  mnPslArrowPathContractJson,
) as MnPslArrowPathContract;

const mnPslArrowPathContext: ExecutionContext<MnPslArrowPathContract> = createExecutionContext({
  contract: mnPslArrowPathContract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensionPacks: [pgvectorRuntime],
  }),
});

function createPostsCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: mnPslArrowPathContext }, 'Post', {
    namespaceId: 'public',
  });
}

// The `posts` / `tags` / `post_tags` schema is not part of setupTestSchema, so
// build it directly. `post_tags` has no relation fields in the contract; the
// foreign keys exist only in the physical table here.
async function createArrowPathMnSchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists post_tags');
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
    create table post_tags (
      post_id integer not null references posts (id),
      tag_id text not null references tags (id),
      primary key (post_id, tag_id)
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
    await runtime.query('insert into post_tags (post_id, tag_id) values ($1, $2)', [
      pt.postId,
      pt.tagId,
    ]);
  }
}

describe('integration/mn-psl-arrow-path-parity', () => {
  it(
    'include("tags") with explicit select returns selected fields on post and tags (whole-row toEqual)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await createArrowPathMnSchema(runtime);

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
      }, mnPslArrowPathContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include("tags") with no .select returns the full default row shape (implicit selection)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await createArrowPathMnSchema(runtime);

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
      }, mnPslArrowPathContext.contract);
    },
    timeouts.spinUpPpgDev,
  );
});
