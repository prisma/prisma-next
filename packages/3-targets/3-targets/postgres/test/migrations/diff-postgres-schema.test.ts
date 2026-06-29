import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { contractToPostgresDatabaseSchemaNode } from '../../src/core/migrations/contract-to-postgres-database-schema-node';
import {
  diffPostgresSchema,
  filterIssuesByOwnership,
} from '../../src/core/migrations/diff-postgres-schema';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

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

function policyNode(policy: PostgresRlsPolicy): PostgresPolicySchemaNode {
  return new PostgresPolicySchemaNode({
    name: policy.name,
    prefix: policy.prefix,
    tableName: policy.tableName,
    namespaceId: policy.namespaceId,
    operation: policy.operation,
    roles: [...policy.roles],
    ...(policy.using !== undefined ? { using: policy.using } : {}),
    ...(policy.withCheck !== undefined ? { withCheck: policy.withCheck } : {}),
    permissive: policy.permissive,
  });
}

/** Wraps one namespace node (keyed by its schema name) into a database root. */
function rootOf(
  namespace: PostgresNamespaceSchemaNode,
  existingSchemas: readonly string[],
): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: { [namespace.schemaName]: namespace },
    roles: [],
    existingSchemas: [...existingSchemas],
    pgVersion: 'unknown',
  });
}

function makeContract(policies: readonly PostgresRlsPolicy[]): Contract<SqlStorage> {
  const policyEntries: Record<string, PostgresRlsPolicy> = {};
  for (const p of policies) {
    policyEntries[`${p.tableName}/${p.name}`] = p;
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

/**
 * Build an actual database root with a single `public` namespace holding the
 * `profiles` table plus any extra tables required to carry the supplied
 * policies (keyed by tableName).
 */
function makeSchema(actualPolicies: readonly PostgresRlsPolicy[]): PostgresDatabaseSchemaNode {
  const policiesByTable = new Map<string, PostgresPolicySchemaNode[]>();
  for (const p of actualPolicies) {
    const list = policiesByTable.get(p.tableName) ?? [];
    list.push(policyNode(p));
    policiesByTable.set(p.tableName, list);
  }

  const tableNames = new Set([TABLE_NAME, ...policiesByTable.keys()]);
  const tables: Record<string, PostgresTableSchemaNode> = {};
  for (const name of tableNames) {
    if (name === TABLE_NAME) {
      tables[name] = new PostgresTableSchemaNode({
        name: TABLE_NAME,
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: policiesByTable.get(name) ?? [],
      });
    } else {
      tables[name] = new PostgresTableSchemaNode({
        name,
        columns: {},
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: policiesByTable.get(name) ?? [],
      });
    }
  }

  return rootOf(
    new PostgresNamespaceSchemaNode({
      schemaName: SCHEMA_NAME,
      tables,
      nativeEnumTypeNames: [],
    }),
    [SCHEMA_NAME],
  );
}

function expectedFor(contract: Contract<SqlStorage>): PostgresDatabaseSchemaNode {
  return contractToPostgresDatabaseSchemaNode(
    contract as Parameters<typeof contractToPostgresDatabaseSchemaNode>[0],
    { annotationNamespace: 'pg' },
  );
}

function ownedSchemaNamesOf(expected: PostgresDatabaseSchemaNode): Set<string> {
  const policyNamespaces = Object.values(expected.namespaces).flatMap((ns) =>
    Object.values(ns.tables).flatMap((t) => t.policies.map((p) => p.namespaceId)),
  );
  return new Set([...policyNamespaces, ...expected.existingSchemas]);
}

describe('diffPostgresSchema', () => {
  it('emits missing outcome when a contract policy is absent from the DB', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const contract = makeContract([policy]);
    const expected = expectedFor(contract);
    const actual = makeSchema([]);

    const issues = diffPostgresSchema(expected, actual);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ outcome: 'missing' });
    expect(issues[0]?.expected).toMatchObject({ name: 'read_own_profiles_a1b2c3d4' });
  });

  it('emits extra outcome when a DB policy is absent from the contract', () => {
    const actualPolicy = makePolicy('read_own_profiles_deadbeef');
    const contract = makeContract([]);
    const expected = expectedFor(contract);
    const actual = makeSchema([actualPolicy]);

    const issues = diffPostgresSchema(expected, actual);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ outcome: 'extra' });
    expect(issues[0]?.actual).toMatchObject({ name: 'read_own_profiles_deadbeef' });
  });

  it('emits no issues when contract and DB policy sets match exactly', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const contract = makeContract([policy]);
    const expected = expectedFor(contract);
    const actual = makeSchema([
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

    const issues = diffPostgresSchema(expected, actual);

    expect(issues).toHaveLength(0);
  });

  it('emits missing + extra for a name change (same prefix, different hash)', () => {
    const newPolicy = makePolicy('read_own_profiles_11111111');
    const oldPolicy = makePolicy('read_own_profiles_00000000');
    const contract = makeContract([newPolicy]);
    const expected = expectedFor(contract);
    const actual = makeSchema([oldPolicy]);

    const issues = diffPostgresSchema(expected, actual);

    expect(issues).toHaveLength(2);
    const outcomes = issues.map((i) => i.outcome);
    expect(outcomes).toContain('missing');
    expect(outcomes).toContain('extra');
  });

  it('carries namespaceId on both missing and extra issues via the node', () => {
    const contractPolicy = makePolicy('rp_a1b2c3d4');
    const actualPolicy = makePolicy('rp_deadbeef');
    const contract = makeContract([contractPolicy]);
    const expected = expectedFor(contract);
    const actual = makeSchema([actualPolicy]);

    const issues = diffPostgresSchema(expected, actual);

    for (const issue of issues) {
      const node = issue.expected ?? issue.actual;
      expect(node).toMatchObject({ namespaceId: SCHEMA_NAME });
    }
  });

  it('returns empty when contract has no policies and DB has no policies', () => {
    const contract = makeContract([]);
    const expected = expectedFor(contract);
    const actual = makeSchema([]);

    const issues = diffPostgresSchema(expected, actual);

    expect(issues).toHaveLength(0);
  });

  it('emits extra for a DB policy on a table not in the contract (strict drop)', () => {
    const outsidePolicy = makePolicy('some_policy_aaaabbbb', 'other_table');
    const contract = makeContract([]);
    const expected = expectedFor(contract);
    const actual = makeSchema([outsidePolicy]);

    const issues = diffPostgresSchema(expected, actual);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ outcome: 'extra' });
  });

  it('ignores DB policies in namespaces the contract does not own (cross-space)', () => {
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

    const schemaWithBothNamespaces = new PostgresDatabaseSchemaNode({
      namespaces: {
        auth: new PostgresNamespaceSchemaNode({
          schemaName: 'auth',
          tables: {
            users: new PostgresTableSchemaNode({
              name: 'users',
              columns: { id: { name: 'id', nativeType: 'uuid', nullable: false } },
              foreignKeys: [],
              uniques: [],
              indexes: [],
              policies: [policyNode(authPolicy)],
            }),
          },
          nativeEnumTypeNames: [],
        }),
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            profile: new PostgresTableSchemaNode({
              name: 'profile',
              columns: {},
              foreignKeys: [],
              uniques: [],
              indexes: [],
              policies: [policyNode(foreignPublicPolicy)],
            }),
          },
          nativeEnumTypeNames: [],
        }),
      },
      roles: [],
      existingSchemas: ['auth', 'public'],
      pgVersion: 'unknown',
    });

    const expected = expectedFor(contractOwningOnlyAuth);
    const rawIssues = diffPostgresSchema(expected, schemaWithBothNamespaces);
    const issues = filterIssuesByOwnership(rawIssues, ownedSchemaNamesOf(expected));

    expect(issues).toHaveLength(0);
  });

  it('diffPostgresSchema alone does not drop unowned extra policies (filtering is caller responsibility)', () => {
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

    const schemaWithBothNamespaces = new PostgresDatabaseSchemaNode({
      namespaces: {
        auth: new PostgresNamespaceSchemaNode({
          schemaName: 'auth',
          tables: {
            users: new PostgresTableSchemaNode({
              name: 'users',
              columns: { id: { name: 'id', nativeType: 'uuid', nullable: false } },
              foreignKeys: [],
              uniques: [],
              indexes: [],
              policies: [policyNode(authPolicy)],
            }),
          },
          nativeEnumTypeNames: [],
        }),
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            profile: new PostgresTableSchemaNode({
              name: 'profile',
              columns: {},
              foreignKeys: [],
              uniques: [],
              indexes: [],
              policies: [policyNode(foreignPublicPolicy)],
            }),
          },
          nativeEnumTypeNames: [],
        }),
      },
      roles: [],
      existingSchemas: ['auth', 'public'],
      pgVersion: 'unknown',
    });

    const expected = expectedFor(contractOwningOnlyAuth);
    const rawIssues = diffPostgresSchema(expected, schemaWithBothNamespaces);
    const extraIssues = rawIssues.filter((i) => i.outcome === 'extra');
    expect(extraIssues.length).toBeGreaterThan(0);
  });

  it('still reports an extra DB policy that is in an owned namespace', () => {
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

    const schema = rootOf(
      new PostgresNamespaceSchemaNode({
        schemaName: 'auth',
        tables: {
          users: new PostgresTableSchemaNode({
            name: 'users',
            columns: { id: { name: 'id', nativeType: 'uuid', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [policyNode(ownedExtra)],
          }),
        },
        nativeEnumTypeNames: [],
      }),
      ['auth'],
    );

    const expected = expectedFor(contractOwningAuth);
    const rawIssues = diffPostgresSchema(expected, schema);
    const issues = filterIssuesByOwnership(rawIssues, ownedSchemaNamesOf(expected));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ outcome: 'extra' });
    expect(issues[0]?.actual).toMatchObject({ name: 'auth_extra_99887766' });
  });

  it('regression: same prefix+body on two different tables does not throw (distinct tables)', () => {
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

    const schema = rootOf(
      new PostgresNamespaceSchemaNode({
        schemaName: SCHEMA_NAME,
        tables: {
          profiles: new PostgresTableSchemaNode({
            name: 'profiles',
            columns: {
              id: { name: 'id', nativeType: 'int4', nullable: false },
              user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
            },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [policyNode(policyOnProfiles)],
          }),
          orders: new PostgresTableSchemaNode({
            name: 'orders',
            columns: {
              id: { name: 'id', nativeType: 'int4', nullable: false },
              user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
            },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [policyNode(policyOnOrders)],
          }),
        },
        nativeEnumTypeNames: [],
      }),
      [SCHEMA_NAME],
    );

    const expected = expectedFor(contract);
    expect(() => diffPostgresSchema(expected, schema)).not.toThrow();
    const issues = diffPostgresSchema(expected, schema);
    expect(issues).toHaveLength(0);
  });

  it('policies nest under tables: initial migration yields policy missing issues with correct paths', () => {
    const policyA = makePolicy('read_own_a1b2c3d4', 'profiles');
    const policyB = makePolicy('read_own_a1b2c3d4', 'orders');

    const bothTableSchema = new PostgresSchema({
      id: SCHEMA_NAME,
      entries: {
        table: {
          profiles: new StorageTable({
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
          orders: new StorageTable({
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
        },
        policy: {
          ['profiles/read_own_a1b2c3d4']: policyA,
          ['orders/read_own_a1b2c3d4']: policyB,
        },
      },
    });

    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:nest-test'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:nest-test'),
        namespaces: { [SCHEMA_NAME]: bothTableSchema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const expected = expectedFor(contract);
    // Actual database root carries the `public` namespace with its tables but no
    // policies — so only the two policy nodes are missing (the namespace and
    // tables match by id).
    const actual = rootOf(
      new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          profiles: new PostgresTableSchemaNode({
            name: 'profiles',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
          }),
          orders: new PostgresTableSchemaNode({
            name: 'orders',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
          }),
        },
        nativeEnumTypeNames: [],
      }),
      ['public'],
    );

    const issues = diffPostgresSchema(expected, actual);

    expect(issues.every((i) => PostgresPolicySchemaNode.is(i.expected ?? i.actual ?? actual))).toBe(
      true,
    );
    expect(issues).toHaveLength(2);
    // Path is [ 'database', schemaName, tableName, policyName ].
    const paths = issues.map((i) => i.path);
    expect(paths.some((p) => p[2] === 'profiles' && p[3] === 'read_own_a1b2c3d4')).toBe(true);
    expect(paths.some((p) => p[2] === 'orders' && p[3] === 'read_own_a1b2c3d4')).toBe(true);
  });

  it('multi-schema normalization: unbound contract policy pairs with public introspected policy (zero issues)', () => {
    const contractPolicy = new PostgresRlsPolicy({
      name: 'read_own_a1b2c3d4',
      prefix: 'read_own',
      tableName: 'profiles',
      namespaceId: UNBOUND_NAMESPACE_ID,
      operation: 'select',
      roles: ['authenticated'],
      using: '(auth.uid() = user_id)',
      permissive: true,
    });

    const unboundSchema = new PostgresSchema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {
          profiles: new StorageTable({
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
        },
        policy: { read_own_a1b2c3d4: contractPolicy },
      },
    });

    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:norm-test'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:norm-test'),
        namespaces: { [UNBOUND_NAMESPACE_ID]: unboundSchema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const introspectedPolicy = new PostgresRlsPolicy({
      name: 'read_own_a1b2c3d4',
      prefix: 'read_own',
      tableName: 'profiles',
      namespaceId: 'public',
      operation: 'select',
      roles: ['authenticated'],
      using: '(auth.uid() = user_id)',
      permissive: true,
    });

    const actual = rootOf(
      new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          profiles: new PostgresTableSchemaNode({
            name: 'profiles',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [policyNode(introspectedPolicy)],
          }),
        },
        nativeEnumTypeNames: [],
      }),
      ['public'],
    );

    const expected = expectedFor(contract);
    const issues = diffPostgresSchema(expected, actual);

    expect(issues).toHaveLength(0);
  });

  it('ownership: extra policy in unowned namespace is dropped; missing in owned namespace is kept', () => {
    const ownedMissing = new PostgresRlsPolicy({
      name: 'missing_policy_a1b2c3d4',
      prefix: 'missing_policy',
      tableName: 'profiles',
      namespaceId: 'public',
      operation: 'select',
      roles: ['authenticated'],
      using: '(true)',
      permissive: true,
    });

    const schema = new PostgresSchema({
      id: 'public',
      entries: {
        table: {
          profiles: new StorageTable({
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
        },
        policy: { missing_policy_a1b2c3d4: ownedMissing },
      },
    });

    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:ownership-test'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:ownership-test'),
        namespaces: { public: schema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const unownedExtra = new PostgresRlsPolicy({
      name: 'extra_policy_deadbeef',
      prefix: 'extra_policy',
      tableName: 'orders',
      namespaceId: 'other_schema',
      operation: 'select',
      roles: ['anon'],
      using: '(true)',
      permissive: true,
    });

    const expected = expectedFor(contract);
    const actual = rootOf(
      new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          orders: new PostgresTableSchemaNode({
            name: 'orders',
            columns: {},
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [policyNode(unownedExtra)],
          }),
        },
        nativeEnumTypeNames: [],
      }),
      ['public', 'other_schema'],
    );

    const rawIssues = diffPostgresSchema(expected, actual);
    const issues = filterIssuesByOwnership(rawIssues, ownedSchemaNamesOf(expected));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ outcome: 'missing' });
    expect(issues[0]?.expected).toMatchObject({ name: 'missing_policy_a1b2c3d4' });
  });

  it('policy issues carry a human-readable message', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const contract = makeContract([policy]);
    const expected = expectedFor(contract);
    const actual = makeSchema([]);

    const issues = diffPostgresSchema(expected, actual);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe(
      'missing: policy "read_own_profiles_a1b2c3d4" on "public"."profiles"',
    );
  });
});
