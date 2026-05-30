import { createSqlContract } from '@prisma-next/contract/testing';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import sqliteControlTargetDescriptor from '../src/core/control-target';
import { SqliteContractSerializer } from '../src/core/sqlite-contract-serializer';

function makeValidContractJson() {
  return createSqlContract({ target: 'sqlite' });
}

function makeContractWithTablesJson() {
  return createSqlContract({
    target: 'sqlite',
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          tables: {
            user: {
              columns: {
                id: { nativeType: 'INTEGER', codecId: 'sqlite/integer@1', nullable: false },
                email: { nativeType: 'TEXT', codecId: 'sqlite/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  });
}

describe('SqliteContractSerializer', () => {
  it('extends SqlContractSerializerBase', () => {
    const serializer = new SqliteContractSerializer();
    expect(serializer).toBeInstanceOf(SqlContractSerializerBase);
  });

  it('deserializes a valid SQL contract envelope', () => {
    const serializer = new SqliteContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());
    expect(contract.targetFamily).toBe('sql');
    expect(
      getStorageNamespace(contract.storage as Record<string, unknown>, UNBOUND_NAMESPACE_ID)!
        .tables,
    ).toEqual({});
  });

  it('hydrates JSON storage into the SQL Contract IR class hierarchy', () => {
    const serializer = new SqliteContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithTablesJson());

    expect(contract.storage).toBeInstanceOf(SqlStorage);
    const userTable = getStorageNamespace(
      contract.storage as Record<string, unknown>,
      UNBOUND_NAMESPACE_ID,
    )!.tables['user'] as StorageTable | undefined;
    expect(userTable).toBeInstanceOf(StorageTable);
    expect(userTable?.columns['id']).toBeInstanceOf(StorageColumn);
  });

  it('rejects an invalid contract (family-shared structural validation runs)', () => {
    const serializer = new SqliteContractSerializer();
    const bad = { ...makeValidContractJson(), targetFamily: 'mongo' };
    expect(() => serializer.deserializeContract(bad)).toThrow();
  });

  it('serializeContract round-trips a JSON-clean contract', () => {
    const serializer = new SqliteContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithTablesJson());
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json));
    expect(reparsed.storage).not.toHaveProperty('kind');
    expect(
      getStorageNamespace(reparsed.storage as Record<string, unknown>, UNBOUND_NAMESPACE_ID).tables
        .user,
    ).not.toHaveProperty('kind');
    expect(
      getStorageNamespace(reparsed.storage as Record<string, unknown>, UNBOUND_NAMESPACE_ID).tables
        .user.columns.id,
    ).not.toHaveProperty('kind');
  });
});

describe('sqliteControlTargetDescriptor', () => {
  it('exposes a contractSerializer property', () => {
    expect(sqliteControlTargetDescriptor.contractSerializer).toBeInstanceOf(
      SqliteContractSerializer,
    );
  });

  it('exposes a schemaVerifier property next to migrations', () => {
    expect(sqliteControlTargetDescriptor.schemaVerifier).toBeDefined();
    expect(sqliteControlTargetDescriptor.migrations).toBeDefined();
  });
});
