// Runtime parity for a 1:N back-relation disambiguated with `@relation(inverse:)`.
//
// `User` and `Post` carry TWO relations between the same pair of models:
// `Post.author` and `Post.editor` are both N:1 FKs to `User`. The two `User`
// back-relations would be ambiguous on their own, so each pins its owning FK by
// pointing at the relation field — `authoredPosts Post[] @relation(inverse: author)`
// and `editedPosts Post[] @relation(inverse: editor)` — the directional
// replacement for the legacy `@relation(name:)` disambiguator.
//
// These tests drive `include()` over EACH back-relation and assert the rows
// joined through the FK the `inverse:` pointer named: `authoredPosts` resolves
// posts by `author_id`, `editedPosts` by `editor_id`. A mis-paired pointer
// would surface the wrong posts (or empty arrays) and fail.
//
// Deserializing the emitted JSON runs the full sql contract validation pipeline,
// so each test also proves the disambiguated 1:N contract round-trips validation.
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
import type { Contract as DisambiguatedContract } from './fixtures/disambiguated-1n-inverse/generated/contract';
import disambiguatedContractJson from './fixtures/disambiguated-1n-inverse/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

// Deserialization runs the full sql contract validation pipeline
// (structure + domain + storage semantics), so a contract that failed to
// round-trip validation would throw here at module load.
const disambiguatedContract = new PostgresContractSerializer().deserializeContract(
  disambiguatedContractJson,
) as DisambiguatedContract;

const disambiguatedContext: ExecutionContext<DisambiguatedContract> = createExecutionContext({
  contract: disambiguatedContract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensionPacks: [pgvectorRuntime],
  }),
});

function createUsersCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: disambiguatedContext }, 'User', {
    namespaceId: 'public',
  });
}

// The base `posts` table (from setupTestSchema) carries only `user_id`. This
// fixture needs the two disambiguated FK columns instead, so drop and recreate
// the table to match the emitted contract's `author_id` / `editor_id` storage.
async function createDisambiguatedSchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists comments');
  await runtime.query('drop table if exists posts');
  await runtime.query(`
    create table posts (
      id integer primary key,
      title text not null,
      author_id integer not null,
      editor_id integer not null
    )
  `);
}

async function seedDisambiguatedPosts(
  runtime: PgIntegrationRuntime,
  posts: readonly { id: number; title: string; authorId: number; editorId: number }[],
): Promise<void> {
  for (const post of posts) {
    await runtime.query(
      'insert into posts (id, title, author_id, editor_id) values ($1, $2, $3, $4)',
      [post.id, post.title, post.authorId, post.editorId],
    );
  }
}

describe('integration/disambiguated-1n-inverse-parity', () => {
  it(
    'include("authoredPosts") returns posts joined by author_id (whole-row toEqual)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await createDisambiguatedSchema(runtime);

        const users = createUsersCollection(runtime);

        await runtime.query(
          "insert into users (id, name, email) values (1, 'Alice', 'alice@example.com')",
        );
        await runtime.query(
          "insert into users (id, name, email) values (2, 'Bob', 'bob@example.com')",
        );
        // Alice authors posts 10 & 11 (Bob edits them); Bob authors post 12
        // (Alice edits it). authoredPosts must follow author_id, not editor_id.
        await seedDisambiguatedPosts(runtime, [
          { id: 10, title: 'Rust intro', authorId: 1, editorId: 2 },
          { id: 11, title: 'Async TS', authorId: 1, editorId: 2 },
          { id: 12, title: 'SQL deep-dive', authorId: 2, editorId: 1 },
        ]);

        const rows = await users
          .select('id', 'name')
          .orderBy((u) => u.id.asc())
          .include('authoredPosts', (posts) =>
            posts.select('id', 'title').orderBy((p) => p.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            authoredPosts: [
              { id: 10, title: 'Rust intro' },
              { id: 11, title: 'Async TS' },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            authoredPosts: [{ id: 12, title: 'SQL deep-dive' }],
          },
        ]);
      }, disambiguatedContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include("editedPosts") returns posts joined by editor_id (whole-row toEqual)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await createDisambiguatedSchema(runtime);

        const users = createUsersCollection(runtime);

        await runtime.query(
          "insert into users (id, name, email) values (1, 'Alice', 'alice@example.com')",
        );
        await runtime.query(
          "insert into users (id, name, email) values (2, 'Bob', 'bob@example.com')",
        );
        await seedDisambiguatedPosts(runtime, [
          { id: 10, title: 'Rust intro', authorId: 1, editorId: 2 },
          { id: 11, title: 'Async TS', authorId: 1, editorId: 2 },
          { id: 12, title: 'SQL deep-dive', authorId: 2, editorId: 1 },
        ]);

        const rows = await users
          .select('id', 'name')
          .orderBy((u) => u.id.asc())
          .include('editedPosts', (posts) => posts.select('id', 'title').orderBy((p) => p.id.asc()))
          .all();

        // The mirror of the authoredPosts case: editedPosts follows editor_id,
        // so Alice edits post 12 and Bob edits posts 10 & 11.
        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            editedPosts: [{ id: 12, title: 'SQL deep-dive' }],
          },
          {
            id: 2,
            name: 'Bob',
            editedPosts: [
              { id: 10, title: 'Rust intro' },
              { id: 11, title: 'Async TS' },
            ],
          },
        ]);
      }, disambiguatedContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include("authoredPosts") with no .select returns the full default row shape (implicit selection)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await createDisambiguatedSchema(runtime);

        const users = createUsersCollection(runtime);

        await runtime.query(
          "insert into users (id, name, email) values (1, 'Alice', 'alice@example.com')",
        );
        await seedDisambiguatedPosts(runtime, [
          { id: 10, title: 'Rust intro', authorId: 1, editorId: 1 },
          { id: 11, title: 'Async TS', authorId: 1, editorId: 1 },
        ]);

        const rows = await users
          .orderBy((u) => u.id.asc())
          .include('authoredPosts', (posts) => posts.orderBy((p) => p.id.asc()))
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            authoredPosts: [
              { id: 10, title: 'Rust intro', authorId: 1, editorId: 1 },
              { id: 11, title: 'Async TS', authorId: 1, editorId: 1 },
            ],
          },
        ]);
      }, disambiguatedContext.contract);
    },
    timeouts.spinUpPpgDev,
  );
});
