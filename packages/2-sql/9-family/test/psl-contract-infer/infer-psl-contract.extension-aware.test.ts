import { computeStorageHash } from '@prisma-next/contract/hashing';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type {
  ContractSpace,
  ControlFamilyDescriptor,
  ControlStack,
} from '@prisma-next/framework-components/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import { flatPslModels } from '@prisma-next/framework-components/psl-ast';
import { sqlContractCanonicalizationHooks } from '@prisma-next/sql-contract/canonicalization-hooks';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { createSqlFamilyInstance } from '../../src/core/control-instance';
import type { SqlControlExtensionDescriptor } from '../../src/core/migrations/types';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

function buildExtension(opts: {
  readonly id: string;
  readonly namespaceId: string;
  readonly tables: Record<string, unknown>;
  readonly namespaceKey?: string;
}): SqlControlExtensionDescriptor<'postgres'> {
  const namespaceKey = opts.namespaceKey ?? opts.namespaceId;
  const allTables = Object.fromEntries(
    Object.entries(opts.tables).map(([name, columns]) => [
      name,
      { columns, uniques: [], indexes: [], foreignKeys: [] },
    ]),
  );

  const hash = computeStorageHash({
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    storage: {
      namespaces: {
        [namespaceKey]: {
          id: opts.namespaceId,
          entries: { table: allTables },
        },
      },
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
        [namespaceKey]: createTestSqlNamespace({
          id: opts.namespaceId,
          entries: { table: allTables as never },
        }),
      },
    }),
  };

  return {
    kind: 'extension' as const,
    id: opts.id,
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    version: '0.0.1',
    contractSpace: {
      contractJson: contract,
      migrations: [],
      headRef: { hash: contract.storage.storageHash as string, invariants: [] },
    } satisfies ContractSpace<Contract<SqlStorage>>,
    create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
  };
}

function makeStack(
  extensions: readonly SqlControlExtensionDescriptor<'postgres'>[],
): ControlStack<'sql', 'postgres'> {
  return createControlStack({
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      create: (() => ({})) as unknown as ControlFamilyDescriptor<'sql'>['create'],
      emission: {
        id: 'sql',
        generateStorageType: () => '{ readonly storageHash: StorageHash }',
        generateModelStorageType: () => 'Record<string, never>',
        getFamilyImports: () => [],
        getFamilyTypeAliases: () => '',
        getTypeMapsExpression: () => 'unknown',
        getContractWrapper: (base: string) => `export type Contract = ${base};`,
      },
    },
    target: {
      kind: 'target',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      contractSerializer: {
        deserializeContract: (json) => json as never,
        serializeContract: (contract) => contract as never,
      },
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    adapter: {
      kind: 'adapter',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    extensionPacks: extensions,
  });
}

function tableIr(name: string): SqlSchemaIR['tables'][string] {
  return {
    name,
    columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
  };
}

function tableIrWithFk(
  name: string,
  fk: { readonly column: string; readonly referencedTable: string },
): SqlSchemaIR['tables'][string] {
  return {
    name,
    columns: {
      id: { name: 'id', nativeType: 'int4', nullable: false },
      [fk.column]: { name: fk.column, nativeType: 'int4', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [
      { columns: [fk.column], referencedTable: fk.referencedTable, referencedColumns: ['id'] },
    ],
    uniques: [],
    indexes: [],
  };
}

describe('inferPslContract extension awareness', () => {
  it('omits a table an extension pack claims in its public namespace', () => {
    const ext = buildExtension({
      id: 'ext-owned',
      namespaceId: 'public',
      tables: { t_owned: { id: { codecId: 'pg/int4@1', nativeType: 'integer', nullable: false } } },
    });
    const instance = createSqlFamilyInstance(makeStack([ext]));

    const schemaIR: SqlSchemaIR = {
      tables: { app_table: tableIr('app_table'), t_owned: tableIr('t_owned') },
    };

    const ast = instance.inferPslContract(schemaIR);
    const modelNames = flatPslModels(ast).map((m) => m.name);
    expect(modelNames).toContain('AppTable');
    expect(modelNames).not.toContain('TOwned');
  });

  it('keeps an introspected public table when the pack claims the same name in a non-public namespace', () => {
    const ext = buildExtension({
      id: 'ext-auth',
      namespaceId: 'auth',
      tables: { users: { id: { codecId: 'pg/int4@1', nativeType: 'integer', nullable: false } } },
    });
    const instance = createSqlFamilyInstance(makeStack([ext]));

    const schemaIR: SqlSchemaIR = {
      tables: { users: tableIr('users'), app_table: tableIr('app_table') },
    };

    const ast = instance.inferPslContract(schemaIR);
    const modelNames = flatPslModels(ast).map((m) => m.name);
    expect(modelNames).toContain('Users');
    expect(modelNames).toContain('AppTable');
  });

  it('drops a surviving table field pointing at a claimed (omitted) table', () => {
    const ext = buildExtension({
      id: 'ext-owned',
      namespaceId: 'public',
      tables: { t_owned: { id: { codecId: 'pg/int4@1', nativeType: 'integer', nullable: false } } },
    });
    const instance = createSqlFamilyInstance(makeStack([ext]));

    const schemaIR: SqlSchemaIR = {
      tables: {
        posts: tableIrWithFk('posts', { column: 'author_id', referencedTable: 't_owned' }),
        t_owned: tableIr('t_owned'),
      },
    };

    const ast = instance.inferPslContract(schemaIR);
    const models = flatPslModels(ast);
    const modelNames = models.map((m) => m.name);
    expect(modelNames).toContain('Posts');
    expect(modelNames).not.toContain('TOwned');

    const fieldTypeNames = models.flatMap((m) => m.fields.map((f) => f.typeName));
    expect(fieldTypeNames).not.toContain('TOwned');
    expect(fieldTypeNames).not.toContain('t_owned');
  });

  it('matches the public namespace by its `.id`, not its record key', () => {
    const ext = buildExtension({
      id: 'ext-owned',
      namespaceId: 'public',
      namespaceKey: 'not-public',
      tables: { t_owned: { id: { codecId: 'pg/int4@1', nativeType: 'integer', nullable: false } } },
    });
    const instance = createSqlFamilyInstance(makeStack([ext]));

    const schemaIR: SqlSchemaIR = {
      tables: { app_table: tableIr('app_table'), t_owned: tableIr('t_owned') },
    };

    const ast = instance.inferPslContract(schemaIR);
    const modelNames = flatPslModels(ast).map((m) => m.name);
    expect(modelNames).toContain('AppTable');
    expect(modelNames).not.toContain('TOwned');
  });
});
