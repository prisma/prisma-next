import { asNamespaceId, coreHash, profileHash } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { SqlForeignKeyIR } from '@prisma-next/sql-schema-ir/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { contractToPostgresDatabaseSchemaNode } from '../../src/core/migrations/contract-to-postgres-database-schema-node';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresRole } from '../../src/core/postgres-role';
import { type PostgresContract, PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import type { SqlSchemaDiffNode } from '../../src/core/schema-ir/schema-node-kinds';
import { postgresRenderDefault } from '../../src/exports/control';

const TABLE_NAME = 'profiles';
const SCHEMA_NAME = 'public';

function makePolicy(name: string): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    name,
    prefix: name.replace(/_[0-9a-f]{8}$/, ''),
    tableName: TABLE_NAME,
    namespaceId: SCHEMA_NAME,
    operation: 'select',
    roles: ['authenticated'],
    using: '(auth.uid() = user_id)',
    permissive: true,
  });
}

const profilesTable = () =>
  new StorageTable({
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      user_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
  });

function makeContract(options: {
  readonly policies?: readonly PostgresRlsPolicy[];
  readonly roles?: readonly PostgresRole[];
}): PostgresContract {
  const policyEntries: Record<string, PostgresRlsPolicy> = {};
  for (const p of options.policies ?? []) {
    policyEntries[p.name] = p;
  }
  const roleEntries: Record<string, PostgresRole> = {};
  for (const r of options.roles ?? []) {
    roleEntries[r.name] = r;
  }
  const schema = new PostgresSchema({
    id: SCHEMA_NAME,
    entries: {
      table: { [TABLE_NAME]: profilesTable() },
      policy: policyEntries,
      role: roleEntries,
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:project-from-contract-test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:project-from-contract-test'),
      namespaces: { [SCHEMA_NAME]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

const projectionOptions = {
  annotationNamespace: 'pg',
  renderDefault: postgresRenderDefault,
} as const;

describe('contractToPostgresDatabaseSchemaNode', () => {
  it('returns a PostgresDatabaseSchemaNode root', () => {
    const root = contractToPostgresDatabaseSchemaNode(makeContract({}), projectionOptions);
    expect(PostgresDatabaseSchemaNode.is(root)).toBe(true);
    expect(root.id).toBe('database');
  });

  it('groups tables under a namespace node', () => {
    const root = contractToPostgresDatabaseSchemaNode(makeContract({}), projectionOptions);
    expect(Object.keys(root.namespaces)).toEqual([SCHEMA_NAME]);
    const ns = root.namespaces[SCHEMA_NAME];
    expect(PostgresNamespaceSchemaNode.is(ns!)).toBe(true);
    expect(Object.keys(ns!.tables)).toEqual([TABLE_NAME]);
    expect(PostgresTableSchemaNode.is(ns!.tables[TABLE_NAME]!)).toBe(true);
  });

  it('children() of the root are namespace nodes', () => {
    const root = contractToPostgresDatabaseSchemaNode(makeContract({}), projectionOptions);
    expect(root.children()).toEqual([root.namespaces[SCHEMA_NAME]]);
  });

  it('attaches a SELECT policy to its table within the namespace', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const root = contractToPostgresDatabaseSchemaNode(
      makeContract({ policies: [policy] }),
      projectionOptions,
    );
    const table = root.namespaces[SCHEMA_NAME]?.tables[TABLE_NAME];
    expect(table?.policies).toContainEqual(expect.objectContaining({ name: policy.name }));
  });

  it('carries owned DDL schema names in existingSchemas on the root', () => {
    const root = contractToPostgresDatabaseSchemaNode(makeContract({}), projectionOptions);
    expect(root.existingSchemas).toEqual([SCHEMA_NAME]);
  });

  it('puts roles on the root, not in children()', () => {
    const role = new PostgresRole({ name: 'app_user', namespaceId: 'public' });
    const root = contractToPostgresDatabaseSchemaNode(
      makeContract({ roles: [role] }),
      projectionOptions,
    );
    expect(root.roles).toContainEqual(expect.objectContaining({ name: 'app_user' }));
    for (const child of root.children()) {
      expect(PostgresNamespaceSchemaNode.is(child as SqlSchemaDiffNode)).toBe(true);
    }
  });

  it('returns an empty root for a null contract', () => {
    const root = contractToPostgresDatabaseSchemaNode(null, projectionOptions);
    expect(PostgresDatabaseSchemaNode.is(root)).toBe(true);
    expect(root.namespaces).toEqual({});
    expect(root.roles).toEqual([]);
    expect(root.existingSchemas).toEqual([]);
  });

  it('projects same-named tables in different schemas into their own namespace nodes', () => {
    const thingTable = () =>
      new StorageTable({
        columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      });
    const contract: PostgresContract = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:same-name-cross-schema'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:same-name-cross-schema'),
        namespaces: {
          public: new PostgresSchema({
            id: 'public',
            entries: { table: { thing: thingTable() } },
          }),
          auth: new PostgresSchema({
            id: 'auth',
            entries: { table: { thing: thingTable() } },
          }),
        },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const root = contractToPostgresDatabaseSchemaNode(contract, projectionOptions);

    expect(Object.keys(root.namespaces).sort()).toEqual(['auth', 'public']);
    expect(Object.keys(root.namespaces['public']!.tables)).toEqual(['thing']);
    expect(Object.keys(root.namespaces['auth']!.tables)).toEqual(['thing']);
    // The two same-named tables are distinct nodes in distinct namespaces.
    expect(root.namespaces['public']!.tables['thing']).not.toBe(
      root.namespaces['auth']!.tables['thing'],
    );
  });

  it('throws when a policy references a table absent from its namespace', () => {
    const orphan = new PostgresRlsPolicy({
      name: 'read_orphan_deadbeef',
      prefix: 'read_orphan',
      tableName: 'missing_table',
      namespaceId: SCHEMA_NAME,
      operation: 'select',
      roles: ['authenticated'],
      permissive: true,
    });
    expect(() =>
      contractToPostgresDatabaseSchemaNode(makeContract({ policies: [orphan] }), projectionOptions),
    ).toThrow(/missing_table/);
  });
});

describe('contractToPostgresDatabaseSchemaNode — FK resolvedReferencedSchema', () => {
  function contractWithFk(targetNamespaceId: string): PostgresContract {
    const schema = new PostgresSchema({
      id: SCHEMA_NAME,
      entries: {
        table: {
          users: new StorageTable({
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
          [TABLE_NAME]: new StorageTable({
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              user_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              {
                source: {
                  namespaceId: asNamespaceId(SCHEMA_NAME),
                  tableName: TABLE_NAME,
                  columns: ['user_id'],
                },
                target: {
                  namespaceId: asNamespaceId(targetNamespaceId),
                  tableName: 'users',
                  columns: ['id'],
                },
                constraint: true,
                index: true,
              },
            ],
            uniques: [],
            indexes: [],
          }),
        },
      },
    });
    return {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:fk-resolution-test'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:fk-resolution-test'),
        namespaces: { [SCHEMA_NAME]: schema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };
  }

  it('resolves an unbound FK target namespace to the real DDL schema', () => {
    const root = contractToPostgresDatabaseSchemaNode(
      contractWithFk(UNBOUND_NAMESPACE_ID),
      projectionOptions,
    );
    const fk = root.namespaces[SCHEMA_NAME]?.tables[TABLE_NAME]?.foreignKeys[0];
    expect(fk?.referencedSchema).toBe(UNBOUND_NAMESPACE_ID);
    expect(fk?.resolvedReferencedSchema).toBe('public');
  });

  it('resolves a named FK target namespace through its DDL schema name', () => {
    const root = contractToPostgresDatabaseSchemaNode(
      contractWithFk(SCHEMA_NAME),
      projectionOptions,
    );
    const fk = root.namespaces[SCHEMA_NAME]?.tables[TABLE_NAME]?.foreignKeys[0];
    expect(fk?.resolvedReferencedSchema).toBe('public');
  });

  it('an unbound-namespace contract FK pairs by id with an introspected public FK', () => {
    const root = contractToPostgresDatabaseSchemaNode(
      contractWithFk(UNBOUND_NAMESPACE_ID),
      projectionOptions,
    );
    const expectedFk = root.namespaces[SCHEMA_NAME]?.tables[TABLE_NAME]?.foreignKeys[0];
    const introspectedFk = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      referencedSchema: 'public',
      name: 'profiles_user_id_fkey',
    });
    expect(expectedFk?.id).toBe(introspectedFk.id);
  });
});
