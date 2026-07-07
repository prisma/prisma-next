import { computeStorageHash } from '@prisma-next/contract/hashing';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
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
 * Builds a described contract — one of the values `inferPostgresPslContract`
 * receives in its `describedContracts` array — declaring the given tables
 * under each namespace id. Each namespace's record key is its own `.id`,
 * matching how a real contract space's storage is keyed.
 */
function describedContract(
  namespaces: Readonly<Record<string, readonly string[]>>,
): Contract<SqlStorage> {
  const storageNamespaces: Record<string, PostgresSchema> = {};
  for (const [namespaceId, tables] of Object.entries(namespaces)) {
    storageNamespaces[namespaceId] = new PostgresSchema({
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

  return {
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
}

describe('inferPostgresPslContract — described-contract omission', () => {
  it('omits a table a described contract declares, keeps the rest', () => {
    const database = tree({
      public: namespaceNode('public', {
        app_table: idColumnTable('app_table'),
        t_owned: idColumnTable('t_owned'),
      }),
    });

    const ast = inferPostgresPslContract(database, [describedContract({ public: ['t_owned'] })]);
    const modelNames = flatPslModels(ast).map((m) => m.name);

    expect(modelNames).toContain('AppTable');
    expect(modelNames).not.toContain('TOwned');
  });

  it('produces byte-identical output for empty and absent describedContracts', () => {
    const database = tree({
      public: namespaceNode('public', {
        app_table: idColumnTable('app_table'),
        t_owned: idColumnTable('t_owned'),
      }),
    });

    const withoutArgument = printPsl(inferPostgresPslContract(database));
    const withEmptyList = printPsl(inferPostgresPslContract(database, []));

    expect(withEmptyList).toBe(withoutArgument);
  });

  it('keeps a table when a described contract declares a same-named table in a different namespace', () => {
    const database = tree({
      public: namespaceNode('public', { users: idColumnTable('users') }),
    });

    const ast = inferPostgresPslContract(database, [describedContract({ auth: ['users'] })]);

    expect(flatPslModels(ast).map((m) => m.name)).toContain('Users');
  });

  it('is entity-kind-precise: a non-table entity of the same name in the same namespace does not omit the table', () => {
    // The described contract declares "widgets" under a pack-contributed
    // entity kind, not `table`. The coordinate key includes `entityKind`, so
    // this must never suppress the introspected `widgets` table — proving
    // the omission is keyed on (namespaceId, entityKind, entityName), not a
    // table-specific predicate.
    const database = tree({
      public: namespaceNode('public', { widgets: idColumnTable('widgets') }),
    });
    const contractWithNonTableEntity: Contract<SqlStorage> = {
      ...describedContract({}),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:contract'),
        namespaces: {
          public: new PostgresSchema({
            id: 'public',
            entries: { widget: { widgets: {} } },
          }),
        },
      }),
    };

    const ast = inferPostgresPslContract(database, [contractWithNonTableEntity]);

    expect(flatPslModels(ast).map((m) => m.name)).toContain('Widgets');
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

    const ast = inferPostgresPslContract(database, [describedContract({ public: ['t_owned'] })]);
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

    const ast = inferPostgresPslContract(database, [describedContract({ auth: ['users'] })]);
    const modelNames = flatPslModels(ast).map((m) => m.name);
    const postsModel = flatPslModels(ast).find((m) => m.name === 'Posts');

    expect(modelNames).not.toContain('AuthUsers');
    expect(modelNames).toContain('Users');
    expect(postsModel?.fields.some((f) => f.typeName === 'Users')).toBe(true);
    expect(postsModel?.fields.some((f) => f.attributes.some((a) => a.name === 'relation'))).toBe(
      true,
    );
  });

  it('omits a described-contract-claimed table before the cross-schema duplicate-name check', () => {
    const database = tree({
      public: namespaceNode('public', { t_owned: idColumnTable('t_owned') }),
      other: namespaceNode('other', { t_owned: idColumnTable('t_owned') }),
    });
    const describedContracts = [describedContract({ other: ['t_owned'] })];

    expect(() => inferPostgresPslContract(database, describedContracts)).not.toThrow();
    const ast = inferPostgresPslContract(database, describedContracts);
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
