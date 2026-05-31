import type { Contract } from '@prisma-next/contract/types';
import {
  SqlContractSerializerBase,
  type SqlEntityHydrationFactory,
} from '@prisma-next/family-sql/ir';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  ForeignKey,
  PrimaryKey,
  SqlStorage,
  StorageColumn,
  StorageTable,
  type StorageTypeInstance,
  toStorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import postgresTargetDescriptor from '../src/exports/control';

function makeValidContractJson() {
  return createSqlContract();
}

function makeContractWithTablesJson() {
  return createSqlContract({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          tables: {
            user: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            post: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [
                {
                  source: {
                    namespaceId: UNBOUND_NAMESPACE_ID,
                    tableName: 'post',
                    columns: ['userId'],
                  },
                  target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
                  constraint: true,
                  index: true,
                },
              ],
            },
          },
        },
      },
    },
  });
}

describe('PostgresContractSerializer', () => {
  it('extends SqlContractSerializerBase', () => {
    const serializer = new PostgresContractSerializer();
    expect(serializer).toBeInstanceOf(SqlContractSerializerBase);
  });

  it('deserializes a valid SQL contract envelope', () => {
    const serializer = new PostgresContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());
    expect(contract.targetFamily).toBe('sql');
    expect(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.tables).toEqual({});
  });

  it('hydrates JSON storage into the SQL Contract IR class hierarchy', () => {
    const serializer = new PostgresContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithTablesJson());

    expect(contract.storage).toBeInstanceOf(SqlStorage);
    const tables = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.tables;
    const userTable = tables['user'] as StorageTable | undefined;
    expect(userTable).toBeInstanceOf(StorageTable);
    expect(userTable?.columns['id']).toBeInstanceOf(StorageColumn);
    expect(userTable?.primaryKey).toBeInstanceOf(PrimaryKey);
    const postTable = tables['post'] as StorageTable | undefined;
    expect(postTable).toBeInstanceOf(StorageTable);
    expect(postTable?.foreignKeys[0]).toBeInstanceOf(ForeignKey);
  });

  it('rejects an invalid contract (family-shared structural validation runs)', () => {
    const serializer = new PostgresContractSerializer();
    const bad = { ...makeValidContractJson(), targetFamily: 'mongo' };
    expect(() => serializer.deserializeContract(bad)).toThrow();
  });

  it('serializeContract round-trips a JSON-clean contract', () => {
    const serializer = new PostgresContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithTablesJson());
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json));
    expect(reparsed).toMatchObject({
      targetFamily: 'sql',
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            kind: 'postgres-unbound-schema',
            tables: {
              user: {
                columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
              },
            },
            enum: {},
          },
        },
      },
    });
    expect(reparsed.storage).not.toHaveProperty('kind');
    expect(reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID].tables.user).not.toHaveProperty(
      'kind',
    );
    expect(
      reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID].tables.user.columns.id,
    ).not.toHaveProperty('kind');
  });

  it('hydrates storage.types entries via the family registry dispatch path', () => {
    const sentinel: StorageTypeInstance = toStorageTypeInstance({
      codecId: 'test/fake-test-entity@1',
      nativeType: 'fake-test-entity',
      typeParams: { proof: true },
    });

    const registry = new Map<string, SqlEntityHydrationFactory>([
      ['fake-test-entity', () => sentinel],
    ]);

    class RegistryDispatchProbeSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
      constructor() {
        super(registry);
      }

      protected override parseSqlContractStructure(_json: unknown): Contract<SqlStorage> {
        const base = createSqlContract() as unknown as Contract<SqlStorage>;
        return {
          ...base,
          storage: {
            ...base.storage,
            types: {
              fake_thing: { kind: 'fake-test-entity' as const },
            },
          },
        } as unknown as Contract<SqlStorage>;
      }
    }

    const contract = new RegistryDispatchProbeSerializer().deserializeContract({});
    expect(contract.storage.types?.['fake_thing']).toBe(sentinel);
  });
});

describe('postgresTargetDescriptor', () => {
  it('exposes a contractSerializer property', () => {
    expect(postgresTargetDescriptor.contractSerializer).toBeInstanceOf(PostgresContractSerializer);
  });

  it('exposes a schemaVerifier property next to migrations', () => {
    expect(postgresTargetDescriptor.schemaVerifier).toBeDefined();
    expect(postgresTargetDescriptor.migrations).toBeDefined();
  });
});
