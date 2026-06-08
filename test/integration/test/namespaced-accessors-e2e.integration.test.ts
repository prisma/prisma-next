/**
 * Explicit namespaced accessors queryable end-to-end (PGlite).
 *
 * Exercises the genuine hard case for namespaced resolution: the SAME bare
 * table name (`users`) is declared in BOTH the `public` and `auth` namespaces
 * with DIFFERENT columns (public has `email`, auth has `token`), the SAME bare
 * model name (`User`) lives in both, and `public.Profile` carries a
 * cross-namespace foreign key to `auth.User`.
 *
 * The fixture is authored through `buildSqlContractFromDefinition` (the TS
 * authoring builder, which now lowers same-bare-table-name-across-namespaces +
 * cross-namespace FK contracts), emitted to a `contract.json` document via the
 * Postgres serializer, then loaded through the `postgres({ contractJson })`
 * facade and driven against a real database:
 *
 *  - `db.sql.public.users` / `db.sql.auth.users`: select / insert / update /
 *    delete on both namespaces, with the emitted SQL qualified per schema
 *    (`"public"."users"` vs `"auth"."users"`).
 *  - `db.orm.public.User` / `db.orm.auth.User`: create / find / update /
 *    delete on both namespaces, returning per-namespace-correct rows.
 *  - the cross-namespace `Profile.user` relation read returns the `auth.User`
 *    row (distinct `token` column) for a `public.Profile`.
 *
 * The distinct per-namespace columns are the discriminator: a mis-qualified
 * query would either read the wrong table's columns or fail outright. Access is
 * via the explicit coordinate accessors only (`sql.<ns>.<table>` /
 * `orm.<ns>.<Model>`); the flat default-namespace ergonomic is not relied upon.
 */

import type { Contract } from '@prisma-next/contract/types';
import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import {
  buildSqlContractFromDefinition,
  type ModelNode,
} from '@prisma-next/postgres/contract-builder';
import postgres from '@prisma-next/postgres/runtime';
import type { ForeignKey, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { Runtime } from '@prisma-next/sql-runtime';
import { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { blindCast } from '@prisma-next/utils/casts';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const serializer = new PostgresContractSerializer();

const idDescriptor = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const textDescriptor = { codecId: 'pg/text@1', nativeType: 'text' } as const;

// The TS author path merges capabilities from the target pack; a full CLI emit
// derives them from the codec/operation pipeline. For this in-test author the
// runtime read/write paths (RETURNING reads, jsonAgg/lateral relation reads)
// need the capability flags present, so they ride on the target pack ref.
const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  capabilities: {
    postgres: { jsonAgg: true, lateral: true, returning: true, limit: true, orderBy: true },
    sql: { defaultInInsert: true, enums: true, lateral: true, returning: true },
  },
};

const publicUser: ModelNode = {
  modelName: 'User',
  tableName: 'users',
  namespaceId: 'public',
  fields: [
    { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false },
    { fieldName: 'email', columnName: 'email', descriptor: textDescriptor, nullable: false },
  ],
  id: { columns: ['id'] },
};

const authUser: ModelNode = {
  modelName: 'User',
  tableName: 'users',
  namespaceId: 'auth',
  fields: [
    { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false },
    { fieldName: 'token', columnName: 'token', descriptor: textDescriptor, nullable: false },
  ],
  id: { columns: ['id'] },
};

const profile: ModelNode = {
  modelName: 'Profile',
  tableName: 'profile',
  namespaceId: 'public',
  fields: [
    { fieldName: 'id', columnName: 'id', descriptor: idDescriptor, nullable: false },
    { fieldName: 'userId', columnName: 'user_id', descriptor: idDescriptor, nullable: false },
  ],
  id: { columns: ['id'] },
  foreignKeys: [
    {
      columns: ['user_id'],
      references: { model: 'User', table: 'users', columns: ['id'], namespaceId: 'auth' },
    },
  ],
  relations: [
    {
      fieldName: 'user',
      toModel: 'User',
      toTable: 'users',
      toNamespaceId: 'auth',
      cardinality: 'N:1',
      on: {
        parentTable: 'profile',
        parentColumns: ['user_id'],
        childTable: 'users',
        childColumns: ['id'],
      },
    },
  ],
};

function buildSameBareTableNameContract(): Contract<SqlStorage> {
  return blindCast<
    Contract<SqlStorage>,
    'authored multi-namespace contract widened to framework supertype'
  >(
    buildSqlContractFromDefinition({
      target: postgresTargetPack,
      namespaces: ['public', 'auth'],
      models: [publicUser, profile, authUser],
    }),
  );
}

// Runtime-only structural views of the namespaced facade surfaces. The driving
// contract is the framework supertype (its precise per-namespace column/model
// literals are not expressible at the deserializer boundary), so these views
// give the test a workable handle on the per-namespace facets without softening
// the runtime resolution being proven. Mirrors the cast style in the
// sql-orm-client namespace tests.
type Plan = SqlQueryPlan<Record<string, unknown>>;
type IdField = { readonly id: unknown };
type SqlFns = { eq(left: unknown, right: unknown): unknown };
type WhereCb = (fields: IdField, fns: SqlFns) => unknown;
type SqlTable = {
  select(...columns: string[]): { build(): Plan };
  insert(rows: ReadonlyArray<Record<string, unknown>>): { build(): Plan };
  update(set: Record<string, unknown>): { where(cb: WhereCb): { build(): Plan } };
  delete(): { where(cb: WhereCb): { build(): Plan } };
};
type SqlView = {
  public: { users: SqlTable };
  auth: { users: SqlTable };
};

type Row = Record<string, unknown>;
type FilteredModel = {
  first(): Promise<Row | null>;
  updateCount(set: Row): Promise<number>;
  deleteCount(): Promise<number>;
  include(relation: string): { first(): Promise<Row | null> };
};
type OrmModel = {
  create(values: Row): Promise<Row>;
  where(filter: Row): FilteredModel;
};
type OrmView = {
  public: { User: OrmModel; Profile: OrmModel };
  auth: { User: OrmModel };
};

type LoweredAdapter = {
  lower(ast: unknown, options: { contract: unknown; params: readonly unknown[] }): { sql: string };
};

async function rows(result: AsyncIterable<Row>): Promise<Row[]> {
  const out: Row[] = [];
  for await (const row of result) {
    out.push(row);
  }
  return out;
}

describe('explicit namespaced accessors end-to-end (PGlite)', () => {
  it('emits the multi-namespace contract.json with same bare table name + cross-namespace FK', () => {
    const contractJson = serializer.serializeContract(buildSameBareTableNameContract());
    const roundTripped = serializer.deserializeContract(contractJson);
    const storage = roundTripped.storage as SqlStorage;

    // Same bare table name `users` in BOTH namespaces, with DIFFERENT columns.
    const publicUsers = storage.namespaces['public']?.entries.table['users'];
    const authUsers = storage.namespaces['auth']?.entries.table['users'];
    expect(publicUsers).toBeDefined();
    expect(authUsers).toBeDefined();
    expect(Object.keys(publicUsers!.columns).sort()).toEqual(['email', 'id']);
    expect(Object.keys(authUsers!.columns).sort()).toEqual(['id', 'token']);

    // Cross-namespace FK: public.profile.user_id -> auth.users.id.
    const profileTable = storage.namespaces['public']?.entries.table['profile'];
    expect(profileTable).toBeDefined();
    const fks: readonly ForeignKey[] = profileTable!.foreignKeys ?? [];
    expect(fks).toHaveLength(1);
    expect(fks[0]).toMatchObject({
      target: { namespaceId: 'auth', tableName: 'users', columns: ['id'] },
    });

    // Domain carries the `User` model in BOTH namespaces (same bare model name),
    // and the cross-namespace relation coordinate on Profile.user.
    const domain = roundTripped.domain.namespaces as Record<
      string,
      {
        models: Record<
          string,
          { relations?: Record<string, { to: { model: string; namespace: string } }> }
        >;
      }
    >;
    expect(domain['public']?.models['User']).toBeDefined();
    expect(domain['auth']?.models['User']).toBeDefined();
    expect(domain['public']?.models['Profile']?.relations?.['user']?.to).toEqual({
      model: 'User',
      namespace: 'auth',
    });
  });

  it(
    'drives sql + orm CRUD on both namespaces and the cross-namespace relation through the facade',
    async () => {
      const contractJson = serializer.serializeContract(buildSameBareTableNameContract());

      await withDevDatabase(async ({ connectionString }) => {
        const client = new Client({ connectionString });
        await client.connect();
        const db = postgres<Contract<SqlStorage>>({ contractJson });
        try {
          await client.query('create schema if not exists auth');
          await client.query(
            'create table "public"."users" (id int4 primary key, email text not null)',
          );
          await client.query(
            'create table "auth"."users" (id int4 primary key, token text not null)',
          );
          await client.query(
            'create table "public"."profile" (id int4 primary key, user_id int4 not null references "auth"."users"(id))',
          );

          const runtime: Runtime = await db.connect({ pg: client });
          const sql = blindCast<SqlView, 'namespaced sql facet view'>(db.sql);
          const orm = blindCast<OrmView, 'namespaced orm facet view'>(db.orm);

          const adapter = blindCast<LoweredAdapter, 'execution stack adapter lowers ast to sql'>(
            instantiateExecutionStack(db.stack).adapter,
          );

          const publicSelectPlan = sql.public.users.select('id', 'email').build();
          const authSelectPlan = sql.auth.users.select('id', 'token').build();
          expect(
            adapter.lower(publicSelectPlan.ast, {
              contract: db.context.contract,
              params: publicSelectPlan.params,
            }).sql,
          ).toContain('"public"."users"');
          expect(
            adapter.lower(authSelectPlan.ast, {
              contract: db.context.contract,
              params: authSelectPlan.params,
            }).sql,
          ).toContain('"auth"."users"');

          await rows(
            runtime.execute(sql.public.users.insert([{ id: 1, email: 'pub@x.io' }]).build()),
          );
          await rows(runtime.execute(sql.auth.users.insert([{ id: 1, token: 'tok-1' }]).build()));

          // Distinct columns prove qualification: public.users has `email`,
          // auth.users has `token`.
          expect(
            await rows(runtime.execute(sql.public.users.select('id', 'email').build())),
          ).toEqual([{ id: 1, email: 'pub@x.io' }]);
          expect(await rows(runtime.execute(sql.auth.users.select('id', 'token').build()))).toEqual(
            [{ id: 1, token: 'tok-1' }],
          );

          await rows(
            runtime.execute(
              sql.public.users
                .update({ email: 'pub2@x.io' })
                .where((f, fns) => fns.eq(f.id, 1))
                .build(),
            ),
          );
          await rows(
            runtime.execute(
              sql.auth.users
                .update({ token: 'tok-2' })
                .where((f, fns) => fns.eq(f.id, 1))
                .build(),
            ),
          );
          expect(
            (await client.query('select email from "public"."users" where id = 1')).rows[0],
          ).toEqual({ email: 'pub2@x.io' });
          expect(
            (await client.query('select token from "auth"."users" where id = 1')).rows[0],
          ).toEqual({ token: 'tok-2' });

          await rows(
            runtime.execute(
              sql.public.users
                .delete()
                .where((f, fns) => fns.eq(f.id, 1))
                .build(),
            ),
          );
          await rows(
            runtime.execute(
              sql.auth.users
                .delete()
                .where((f, fns) => fns.eq(f.id, 1))
                .build(),
            ),
          );
          expect((await client.query('select * from "public"."users"')).rows).toHaveLength(0);
          expect((await client.query('select * from "auth"."users"')).rows).toHaveLength(0);

          expect(await orm.public.User.create({ id: 10, email: 'alice@x.io' })).toEqual({
            id: 10,
            email: 'alice@x.io',
          });
          expect(await orm.auth.User.create({ id: 20, token: 'auth-tok' })).toEqual({
            id: 20,
            token: 'auth-tok',
          });

          expect(await orm.public.User.where({ id: 10 }).first()).toEqual({
            id: 10,
            email: 'alice@x.io',
          });
          expect(await orm.auth.User.where({ id: 20 }).first()).toEqual({
            id: 20,
            token: 'auth-tok',
          });

          await orm.public.User.where({ id: 10 }).updateCount({ email: 'alice2@x.io' });
          await orm.auth.User.where({ id: 20 }).updateCount({ token: 'auth-tok-2' });
          expect((await orm.public.User.where({ id: 10 }).first())?.['email']).toBe('alice2@x.io');
          expect((await orm.auth.User.where({ id: 20 }).first())?.['token']).toBe('auth-tok-2');

          await orm.public.Profile.create({ id: 100, userId: 20 });
          const withUser = await orm.public.Profile.where({ id: 100 }).include('user').first();
          // The included `user` is the auth.User row (distinct `token` column).
          expect(withUser).toMatchObject({
            id: 100,
            userId: 20,
            user: { id: 20, token: 'auth-tok-2' },
          });

          await orm.public.User.where({ id: 10 }).deleteCount();
          expect(await orm.public.User.where({ id: 10 }).first()).toBeNull();
        } finally {
          await db.close();
          await client.end();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
