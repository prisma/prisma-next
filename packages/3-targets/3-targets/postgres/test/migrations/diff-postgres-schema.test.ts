import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { diffPostgresSchema } from '../../src/core/migrations/diff-postgres-schema';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresSchemaIR } from '../../src/core/postgres-schema-ir';

const TABLE_NAME = 'profiles';
const SCHEMA_NAME = 'public';

function makePolicy(
  name: string,
  tableName = TABLE_NAME,
  namespaceId = SCHEMA_NAME,
): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    name,
    prefix: name.replace(/_[0-9a-f]{8}$/, ''),
    tableName,
    namespaceId,
    operation: 'select',
    roles: ['authenticated'],
    using: '(auth.uid() = user_id)',
    permissive: true,
  });
}

function makeContract(policies: readonly PostgresRlsPolicy[]): Contract<SqlStorage> {
  const policyEntries: Record<string, PostgresRlsPolicy> = {};
  for (const p of policies) {
    policyEntries[p.name] = p;
  }
  const schema = new PostgresSchema({
    id: SCHEMA_NAME,
    entries: {
      table: {
        [TABLE_NAME]: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            user_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      policy: policyEntries,
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:rls-verify-test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:rls-verify-test'),
      namespaces: { [SCHEMA_NAME]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function makeSchema(actualPolicies: readonly PostgresRlsPolicy[]): PostgresSchemaIR {
  return new PostgresSchemaIR({
    tables: {
      [TABLE_NAME]: {
        name: TABLE_NAME,
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    },
    pgSchemaName: 'public',
    pgVersion: 'unknown',
    rlsPolicies: actualPolicies,
    roles: [],
    existingSchemas: ['public'],
    nativeEnumTypeNames: [],
  });
}

describe('diffPostgresSchema', () => {
  it('emits missing outcome when a contract policy is absent from the DB', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const contract = makeContract([policy]);
    const schema = makeSchema([]);

    const issues = diffPostgresSchema({ contract, schema });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ outcome: 'missing' });
    expect(issues[0]?.expected).toMatchObject({ name: 'read_own_profiles_a1b2c3d4' });
  });

  it('emits extra outcome when a DB policy is absent from the contract', () => {
    const actualPolicy = makePolicy('read_own_profiles_deadbeef');
    const contract = makeContract([]);
    const schema = makeSchema([actualPolicy]);

    const issues = diffPostgresSchema({ contract, schema });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ outcome: 'extra' });
    expect(issues[0]?.actual).toMatchObject({ name: 'read_own_profiles_deadbeef' });
  });

  it('emits no issues when contract and DB policy sets match exactly', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const contract = makeContract([policy]);
    const schema = makeSchema([
      new PostgresRlsPolicy({
        name: 'read_own_profiles_a1b2c3d4',
        prefix: 'read_own_profiles',
        tableName: TABLE_NAME,
        namespaceId: SCHEMA_NAME,
        operation: 'select',
        roles: ['authenticated'],
        using: '(auth.uid() = user_id)',
        permissive: true,
      }),
    ]);

    const issues = diffPostgresSchema({ contract, schema });

    expect(issues).toHaveLength(0);
  });

  it('emits missing + extra for a name change (same prefix, different hash)', () => {
    const newPolicy = makePolicy('read_own_profiles_11111111');
    const oldPolicy = makePolicy('read_own_profiles_00000000');
    const contract = makeContract([newPolicy]);
    const schema = makeSchema([oldPolicy]);

    const issues = diffPostgresSchema({ contract, schema });

    expect(issues).toHaveLength(2);
    const outcomes = issues.map((i) => i.outcome);
    expect(outcomes).toContain('missing');
    expect(outcomes).toContain('extra');
  });

  it('carries namespaceId on both missing and extra issues via the node', () => {
    const contractPolicy = makePolicy('rp_a1b2c3d4');
    const actualPolicy = makePolicy('rp_deadbeef');
    const contract = makeContract([contractPolicy]);
    const schema = makeSchema([actualPolicy]);

    const issues = diffPostgresSchema({ contract, schema });

    for (const issue of issues) {
      const node = issue.expected ?? issue.actual;
      expect(node).toMatchObject({ namespaceId: SCHEMA_NAME });
    }
  });

  it('returns empty when contract has no policies and DB has no policies', () => {
    const contract = makeContract([]);
    const schema = makeSchema([]);

    const issues = diffPostgresSchema({ contract, schema });

    expect(issues).toHaveLength(0);
  });

  it('emits extra for a DB policy on a table not in the contract (strict drop)', () => {
    const outsidePolicy = makePolicy('some_policy_aaaabbbb', 'other_table');
    const contract = makeContract([]);
    const schema = makeSchema([outsidePolicy]);

    const issues = diffPostgresSchema({ contract, schema });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ outcome: 'extra' });
  });

  it('ignores DB policies in namespaces the contract does not own (cross-space)', () => {
    // The diff is scoped to namespaces the verified contract owns. A policy in
    // another space's namespace (e.g. the app's `public.profile` when verifying
    // the supabase space, which owns only `auth`) is external and must not be
    // reported as extra.
    const authPolicy = makePolicy('auth_policy_a1b2c3d4', 'users', 'auth');
    const foreignPublicPolicy = makePolicy('profile_owner_read_3486711c', 'profile', 'public');

    const authSchema = new PostgresSchema({
      id: 'auth',
      entries: {
        table: {
          users: new StorageTable({
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
        },
        policy: { [authPolicy.name]: authPolicy },
      },
    });

    const contractOwningOnlyAuth: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:rls-cross-space-test'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:rls-cross-space-test'),
        namespaces: { auth: authSchema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const schemaWithBothNamespaces = new PostgresSchemaIR({
      tables: {
        users: {
          name: 'users',
          columns: { id: { name: 'id', nativeType: 'uuid', nullable: false } },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      pgSchemaName: 'auth',
      pgVersion: 'unknown',
      rlsPolicies: [authPolicy, foreignPublicPolicy],
      roles: [],
      existingSchemas: ['auth', 'public'],
      nativeEnumTypeNames: [],
    });

    const issues = diffPostgresSchema({
      contract: contractOwningOnlyAuth,
      schema: schemaWithBothNamespaces,
    });

    // `auth` policy matches; the foreign `public` policy is outside the owned
    // namespace set and is ignored entirely.
    expect(issues).toHaveLength(0);
  });

  it('still reports an extra DB policy that is in an owned namespace', () => {
    // Scoping must not suppress a genuine extra in a namespace the contract owns.
    const ownedExtra = makePolicy('auth_extra_99887766', 'users', 'auth');

    const authSchema = new PostgresSchema({
      id: 'auth',
      entries: {
        table: {
          users: new StorageTable({
            columns: { id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false } },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
        },
        policy: {},
      },
    });

    const contractOwningAuth: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:rls-owned-extra-test'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:rls-owned-extra-test'),
        namespaces: { auth: authSchema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const schema = new PostgresSchemaIR({
      tables: {
        users: {
          name: 'users',
          columns: { id: { name: 'id', nativeType: 'uuid', nullable: false } },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      pgSchemaName: 'auth',
      pgVersion: 'unknown',
      rlsPolicies: [ownedExtra],
      roles: [],
      existingSchemas: ['auth'],
      nativeEnumTypeNames: [],
    });

    const issues = diffPostgresSchema({ contract: contractOwningAuth, schema });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ outcome: 'extra' });
    expect(issues[0]?.actual).toMatchObject({ name: 'auth_extra_99887766' });
  });

  it('regression: same prefix+body on two different tables does not throw (distinct paths)', () => {
    // The bug: coord() = {namespace, 'policy', wireName} omits the table,
    // so two tables with identical policy names (same prefix + same body hash)
    // produced a duplicate-key throw. localKey() = namespace/table/name is unique.
    const WIRE_NAME = 'read_own_a1b2c3d4';
    const policyOnProfiles = makePolicy(WIRE_NAME, 'profiles');
    const policyOnOrders = makePolicy(WIRE_NAME, 'orders');

    const bothTableSchema = new PostgresSchema({
      id: SCHEMA_NAME,
      entries: {
        table: {
          profiles: new StorageTable({
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              user_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
          orders: new StorageTable({
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              user_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
        },
        policy: {
          [`profiles/${WIRE_NAME}`]: policyOnProfiles,
          [`orders/${WIRE_NAME}`]: policyOnOrders,
        },
      },
    });

    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:rls-two-tables-test'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:rls-two-tables-test'),
        namespaces: { [SCHEMA_NAME]: bothTableSchema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const schema = new PostgresSchemaIR({
      tables: {
        profiles: {
          name: 'profiles',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        orders: {
          name: 'orders',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      pgSchemaName: SCHEMA_NAME,
      pgVersion: 'unknown',
      rlsPolicies: [policyOnProfiles, policyOnOrders],
      roles: [],
      existingSchemas: [SCHEMA_NAME],
      nativeEnumTypeNames: [],
    });

    // Must not throw; both policies are present so no issues.
    expect(() => diffPostgresSchema({ contract, schema })).not.toThrow();
    const issues = diffPostgresSchema({ contract, schema });
    expect(issues).toHaveLength(0);
  });
});
