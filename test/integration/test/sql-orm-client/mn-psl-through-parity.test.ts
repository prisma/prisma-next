// Runtime parity for an M:N authored with the explicit `@relation(through:)`
// keyword.
//
// `mn-psl-parity.test.ts` drives the bare-list PSL M:N fixture
// (`fixtures/mn-psl`). This file drives the explicit-junction fixture
// (`fixtures/mn-psl-through`): `tags Tag[] @relation(through: UserTag)` on the
// `User` end with a bare `users User[]` inverse on `Tag`. The PSL interpreter
// recognises the M:N via the named junction and lowers both ends to
// `cardinality: 'N:M'` + `through` — the same contract the bare-list form
// emits — so the explicit `through:` keyword drives the ORM `include` through
// a real emitted PSL contract end-to-end.
//
// Deserializing the emitted JSON below runs the full sql contract validation
// pipeline, so each test also proves the explicit-`through:`-emitted M:N
// contract round-trips validation.
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
import type { Contract as MnPslThroughContract } from './fixtures/mn-psl-through/generated/contract';
import mnPslThroughContractJson from './fixtures/mn-psl-through/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';
import { seedTags, seedUsers, seedUserTags } from './runtime-helpers';

const TAG_RUST = 'tag-rust';
const TAG_TS = 'tag-typescript';

// Deserialization runs the full sql contract validation pipeline
// (structure + domain + storage semantics), so a contract that failed to
// round-trip validation would throw here at module load.
const mnPslThroughContract = new PostgresContractSerializer().deserializeContract(
  mnPslThroughContractJson,
) as MnPslThroughContract;

const mnPslThroughContext: ExecutionContext<MnPslThroughContract> = createExecutionContext({
  contract: mnPslThroughContract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensionPacks: [pgvectorRuntime],
  }),
});

function createUsersCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: mnPslThroughContext }, 'User', {
    namespaceId: 'public',
  });
}

describe('integration/mn-psl-through-parity', () => {
  it(
    'include("tags") with explicit select returns selected fields on user and tags (whole-row toEqual)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        await seedUserTags(runtime, [
          { userId: 1, tagId: TAG_RUST },
          { userId: 1, tagId: TAG_TS },
          { userId: 2, tagId: TAG_TS },
        ]);

        const rows = await users
          .select('id', 'name')
          .orderBy((u) => u.id.asc())
          .include('tags', (tags) => tags.select('id', 'name').orderBy((t) => t.name.asc()))
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            tags: [
              { id: TAG_RUST, name: 'Rust' },
              { id: TAG_TS, name: 'TypeScript' },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            tags: [{ id: TAG_TS, name: 'TypeScript' }],
          },
        ]);
      }, mnPslThroughContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include("tags") with no .select returns the full default row shape (implicit selection)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        await seedUserTags(runtime, [
          { userId: 1, tagId: TAG_RUST },
          { userId: 1, tagId: TAG_TS },
        ]);

        const rows = await users
          .orderBy((u) => u.id.asc())
          .include('tags', (tags) => tags.orderBy((t) => t.name.asc()))
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            tags: [
              { id: TAG_RUST, name: 'Rust' },
              { id: TAG_TS, name: 'TypeScript' },
            ],
          },
        ]);
      }, mnPslThroughContext.contract);
    },
    timeouts.spinUpPpgDev,
  );
});
