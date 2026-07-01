// Runtime parity attempt for a self-referential M:N authored with
// `@relation(through: Junction.relationField)`.
//
// `User.following` / `User.followers` are a self-referential many-to-many
// through the `Follow` junction (`follower_id` / `followee_id`, both → `users`).
// Each end disambiguates its parent leg by pointing at the junction relation
// field — `following @relation(through: Follow.follower)` /
// `followers @relation(through: Follow.followee)`. The interpreter lowers both
// ends to `cardinality: 'N:M'` + `through` (proven by the S3·M2 lowering unit
// test and by the module-load validation below).
//
// This file probes whether the runtime can DRIVE that contract: a self-ref M:N
// `include` is a self-join of the junction + target onto the same `users` table.
// If the runtime cannot alias the self-join (wrong rows / thrown error), that is
// a runtime limitation, NOT a contract defect — the lowering is already proven.
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
import type { Contract as SelfRefMnContract } from './fixtures/self-ref-mn-through/generated/contract';
import selfRefMnContractJson from './fixtures/self-ref-mn-through/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

// Deserialization runs the full sql contract validation pipeline
// (structure + domain + storage semantics), so a contract that failed to
// round-trip validation would throw here at module load. This is the
// contract-level confirmation: the self-referential M:N lowering is valid even
// if the runtime cannot drive the self-join.
const selfRefMnContract = new PostgresContractSerializer().deserializeContract(
  selfRefMnContractJson,
) as SelfRefMnContract;

const selfRefMnContext: ExecutionContext<SelfRefMnContract> = createExecutionContext({
  contract: selfRefMnContract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensionPacks: [pgvectorRuntime],
  }),
});

function createUsersCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: selfRefMnContext }, 'User', {
    namespaceId: 'public',
  });
}

// The `follows` self-referential junction is not part of setupTestSchema, so
// recreate `users` without the base extra columns and add the junction.
async function createFollowSchema(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists user_tags');
  await runtime.query('drop table if exists follows');
  await runtime.query('drop table if exists posts');
  await runtime.query('drop table if exists users');
  await runtime.query(`
    create table users (
      id integer primary key,
      name text not null
    )
  `);
  await runtime.query(`
    create table follows (
      follower_id integer not null,
      followee_id integer not null,
      primary key (follower_id, followee_id)
    )
  `);
}

async function seedFollowUsers(
  runtime: PgIntegrationRuntime,
  users: readonly { id: number; name: string }[],
): Promise<void> {
  for (const user of users) {
    await runtime.query('insert into users (id, name) values ($1, $2)', [user.id, user.name]);
  }
}

async function seedFollows(
  runtime: PgIntegrationRuntime,
  follows: readonly { followerId: number; followeeId: number }[],
): Promise<void> {
  for (const f of follows) {
    await runtime.query('insert into follows (follower_id, followee_id) values ($1, $2)', [
      f.followerId,
      f.followeeId,
    ]);
  }
}

describe('integration/self-ref-mn-through-parity', () => {
  it(
    'include("following") returns the users this user follows (whole-row toEqual)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await createFollowSchema(runtime);

        const users = createUsersCollection(runtime);

        await seedFollowUsers(runtime, [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Cara' },
        ]);
        // Alice follows Bob and Cara; Bob follows Cara; Cara follows nobody.
        await seedFollows(runtime, [
          { followerId: 1, followeeId: 2 },
          { followerId: 1, followeeId: 3 },
          { followerId: 2, followeeId: 3 },
        ]);

        const rows = await users
          .select('id', 'name')
          .orderBy((u) => u.id.asc())
          .include('following', (following) =>
            following.select('id', 'name').orderBy((f) => f.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            following: [
              { id: 2, name: 'Bob' },
              { id: 3, name: 'Cara' },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            following: [{ id: 3, name: 'Cara' }],
          },
          {
            id: 3,
            name: 'Cara',
            following: [],
          },
        ]);
      }, selfRefMnContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include("followers") returns the users that follow this user (whole-row toEqual)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await createFollowSchema(runtime);

        const users = createUsersCollection(runtime);

        await seedFollowUsers(runtime, [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Cara' },
        ]);
        await seedFollows(runtime, [
          { followerId: 1, followeeId: 2 },
          { followerId: 1, followeeId: 3 },
          { followerId: 2, followeeId: 3 },
        ]);

        const rows = await users
          .select('id', 'name')
          .orderBy((u) => u.id.asc())
          .include('followers', (followers) =>
            followers.select('id', 'name').orderBy((f) => f.id.asc()),
          )
          .all();

        // The mirror leg: Bob is followed by Alice; Cara by Alice and Bob.
        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            followers: [],
          },
          {
            id: 2,
            name: 'Bob',
            followers: [{ id: 1, name: 'Alice' }],
          },
          {
            id: 3,
            name: 'Cara',
            followers: [
              { id: 1, name: 'Alice' },
              { id: 2, name: 'Bob' },
            ],
          },
        ]);
      }, selfRefMnContext.contract);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include("following") with no .select returns the full default row shape (implicit selection)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await createFollowSchema(runtime);

        const users = createUsersCollection(runtime);

        await seedFollowUsers(runtime, [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]);
        await seedFollows(runtime, [{ followerId: 1, followeeId: 2 }]);

        const rows = await users
          .orderBy((u) => u.id.asc())
          .include('following', (following) => following.orderBy((f) => f.id.asc()))
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            following: [{ id: 2, name: 'Bob' }],
          },
          {
            id: 2,
            name: 'Bob',
            following: [],
          },
        ]);
      }, selfRefMnContext.contract);
    },
    timeouts.spinUpPpgDev,
  );
});
