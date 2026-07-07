import { computeStorageHash } from '@prisma-next/contract/hashing';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type {
  SqlAggregateContractMember,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import sqlFamilyDescriptor from '@prisma-next/family-sql/control';
import type { ContractSpace, ControlStack } from '@prisma-next/framework-components/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import { flatPslModels } from '@prisma-next/framework-components/psl-ast';
import { printPsl } from '@prisma-next/psl-printer';
import { sqlContractCanonicalizationHooks } from '@prisma-next/sql-contract/canonicalization-hooks';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { inferPostgresPslContract } from '../../src/core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import postgresTargetDescriptor from '../../src/exports/control';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

function idColumnTable(name: string, foreignKeys: PostgresTableSchemaNode['foreignKeys'] = []) {
  return new PostgresTableSchemaNode({
    name,
    columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
    primaryKey: { columns: ['id'] },
    foreignKeys,
    uniques: [],
    indexes: [],
    policies: [],
  });
}

function namespaceNode(schemaName: string, tables: Record<string, PostgresTableSchemaNode>) {
  return new PostgresNamespaceSchemaNode({ schemaName, tables, nativeEnumTypeNames: [] });
}

function tree(namespaces: Record<string, PostgresNamespaceSchemaNode>) {
  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles: [],
    existingSchemas: Object.keys(namespaces),
    pgVersion: '',
  });
}

/**
 * Builds an aggregate member's `Contract<SqlStorage>`. Each namespace's
 * record key (the object property under which it is stored in `namespaces`)
 * can differ from its own `.id` — the inferrer must match by `.id`, not by
 * record key.
 */
function aggregateMember(
  id: string,
  namespaces: Readonly<
    Record<string, { readonly namespaceId: string; readonly tables: readonly string[] }>
  >,
): SqlAggregateContractMember {
  const storageNamespaces: Record<string, PostgresSchema> = {};
  for (const [recordKey, { namespaceId, tables }] of Object.entries(namespaces)) {
    storageNamespaces[recordKey] = new PostgresSchema({
      id: namespaceId,
      entries: {
        table: Object.fromEntries(
          tables.map((tableName) => [
            tableName,
            { columns: {}, uniques: [], indexes: [], foreignKeys: [] },
          ]),
        ),
      },
    });
  }

  const contract: Contract<SqlStorage> = {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:contract'),
      namespaces: storageNamespaces,
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };

  return { id, contract };
}

describe('inferPostgresPslContract — aggregate omission', () => {
  it('omits a table an aggregate member describes, keeps the rest', () => {
    const database = tree({
      public: namespaceNode('public', {
        app_table: idColumnTable('app_table'),
        t_owned: idColumnTable('t_owned'),
      }),
    });
    const aggregate = [
      aggregateMember('pack', { public: { namespaceId: 'public', tables: ['t_owned'] } }),
    ];

    const ast = inferPostgresPslContract(database, { aggregate });
    const modelNames = flatPslModels(ast).map((m) => m.name);

    expect(modelNames).toContain('AppTable');
    expect(modelNames).not.toContain('TOwned');
  });

  it('produces byte-identical output for an empty aggregate and for no context at all', () => {
    const database = tree({
      public: namespaceNode('public', {
        app_table: idColumnTable('app_table'),
        t_owned: idColumnTable('t_owned'),
      }),
    });

    const withoutContext = printPsl(inferPostgresPslContract(database));
    const withEmptyAggregate = printPsl(inferPostgresPslContract(database, { aggregate: [] }));

    expect(withEmptyAggregate).toBe(withoutContext);
  });

  it('keeps a table when the aggregate describes a same-named table in a different namespace', () => {
    const database = tree({
      public: namespaceNode('public', { users: idColumnTable('users') }),
    });
    const aggregate = [
      aggregateMember('auth-pack', { auth: { namespaceId: 'auth', tables: ['users'] } }),
    ];

    const ast = inferPostgresPslContract(database, { aggregate });

    expect(flatPslModels(ast).map((m) => m.name)).toContain('Users');
  });

  it('matches an aggregate namespace by its id, not the record key it is stored under', () => {
    const database = tree({
      public: namespaceNode('public', { t_owned: idColumnTable('t_owned') }),
    });
    // The namespace is stored under the record key "not-public" but its own
    // `.id` is "public" — matching by record key would miss this and fail to
    // omit; matching by `.id` (the required behaviour) omits it.
    const aggregate = [
      aggregateMember('pack', { 'not-public': { namespaceId: 'public', tables: ['t_owned'] } }),
    ];

    const ast = inferPostgresPslContract(database, { aggregate });

    expect(flatPslModels(ast).map((m) => m.name)).not.toContain('TOwned');
  });

  it('strips a foreign key referencing an omitted table, leaving no dangling relation', () => {
    const database = tree({
      public: namespaceNode('public', {
        t_owned: idColumnTable('t_owned'),
        posts: new PostgresTableSchemaNode({
          name: 'posts',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            owned_id: { name: 'owned_id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            { columns: ['owned_id'], referencedTable: 't_owned', referencedColumns: ['id'] },
          ],
          uniques: [],
          indexes: [],
          policies: [],
        }),
      }),
    });
    const aggregate = [
      aggregateMember('pack', { public: { namespaceId: 'public', tables: ['t_owned'] } }),
    ];

    const ast = inferPostgresPslContract(database, { aggregate });
    const modelNames = flatPslModels(ast).map((m) => m.name);
    const postsModel = flatPslModels(ast).find((m) => m.name === 'Posts');

    expect(modelNames).not.toContain('TOwned');
    expect(postsModel?.fields.some((f) => f.typeName === 'TOwned')).toBe(false);
    expect(postsModel?.fields.some((f) => f.attributes.some((a) => a.name === 'relation'))).toBe(
      false,
    );
  });

  it('keeps a legitimate FK to a surviving same-named table when a different namespace omits that name', () => {
    const database = tree({
      auth: namespaceNode('auth', { users: idColumnTable('users') }),
      public: namespaceNode('public', {
        users: idColumnTable('users'),
        posts: new PostgresTableSchemaNode({
          name: 'posts',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            { columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] },
          ],
          uniques: [],
          indexes: [],
          policies: [],
        }),
      }),
    });
    const aggregate = [
      aggregateMember('pack', { auth: { namespaceId: 'auth', tables: ['users'] } }),
    ];

    const ast = inferPostgresPslContract(database, { aggregate });
    const modelNames = flatPslModels(ast).map((m) => m.name);
    const postsModel = flatPslModels(ast).find((m) => m.name === 'Posts');

    expect(modelNames).not.toContain('AuthUsers');
    expect(modelNames).toContain('Users');
    expect(postsModel?.fields.some((f) => f.typeName === 'Users')).toBe(true);
    expect(postsModel?.fields.some((f) => f.attributes.some((a) => a.name === 'relation'))).toBe(
      true,
    );
  });

  it('omits a pack-claimed table before the cross-schema duplicate-name check', () => {
    const database = tree({
      public: namespaceNode('public', { t_owned: idColumnTable('t_owned') }),
      other: namespaceNode('other', { t_owned: idColumnTable('t_owned') }),
    });
    const aggregate = [
      aggregateMember('pack', { other: { namespaceId: 'other', tables: ['t_owned'] } }),
    ];

    expect(() => inferPostgresPslContract(database, { aggregate })).not.toThrow();
    const ast = inferPostgresPslContract(database, { aggregate });
    expect(flatPslModels(ast).map((m) => m.name)).toContain('TOwned');
  });
});

/**
 * Builds a minimal extension pack descriptor whose `contractSpace` declares
 * one table in `public`, with a correctly computed `headRef.hash` — the real
 * family instance asserts descriptor self-consistency on load.
 */
function buildExtensionWithPublicTable(
  id: string,
  tableName: string,
): SqlControlExtensionDescriptor<'postgres'> {
  const table = { columns: {}, uniques: [], indexes: [], foreignKeys: [] };

  const hash = computeStorageHash({
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    storage: {
      namespaces: { public: { id: 'public', entries: { table: { [tableName]: table } } } },
    },
    ...sqlContractCanonicalizationHooks,
  });

  const contract: Contract<SqlStorage> = {
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
    profileHash: profileHash('fixture-profile-v1'),
    storage: new SqlStorage({
      storageHash: coreHash(hash),
      namespaces: {
        public: new PostgresSchema({ id: 'public', entries: { table: { [tableName]: table } } }),
      },
    }),
  };

  return {
    kind: 'extension' as const,
    id,
    familyId: TARGET_FAMILY,
    targetId: TARGET,
    version: '0.0.1',
    contractSpace: {
      contractJson: contract,
      migrations: [],
      headRef: { hash, invariants: [] },
    } satisfies ContractSpace<Contract<SqlStorage>>,
    create: () => ({ familyId: TARGET_FAMILY, targetId: TARGET }),
  };
}

function makeRealPostgresStack(
  extensions: readonly SqlControlExtensionDescriptor<'postgres'>[],
): ControlStack<'sql', 'postgres'> {
  return createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: {
      kind: 'adapter',
      id: 'postgres',
      version: '0.0.1',
      familyId: TARGET_FAMILY,
      targetId: TARGET,
      create: () => ({ familyId: TARGET_FAMILY, targetId: TARGET }),
    },
    extensionPacks: extensions,
  });
}

describe('SqlFamilyInstance#inferPslContract — real postgres descriptor + real family instance', () => {
  it('omits an extension-owned table from a real introspected Postgres tree', () => {
    const pack = buildExtensionWithPublicTable('pack', 't_owned');
    const familyInstance = sqlFamilyDescriptor.create(makeRealPostgresStack([pack]));

    const database = tree({
      public: namespaceNode('public', {
        app_table: idColumnTable('app_table'),
        t_owned: idColumnTable('t_owned'),
      }),
    });

    const ast = familyInstance.inferPslContract(database);
    const modelNames = flatPslModels(ast).map((m) => m.name);

    expect(modelNames).toContain('AppTable');
    expect(modelNames).not.toContain('TOwned');
  });
});
