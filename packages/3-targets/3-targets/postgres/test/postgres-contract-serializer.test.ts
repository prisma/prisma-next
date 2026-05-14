import { createSqlContract } from '@prisma-next/contract/testing';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import {
  ForeignKey,
  PrimaryKey,
  SqlStorage,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import postgresTargetDescriptor from '../src/exports/control';

function makeValidContractJson() {
  return createSqlContract();
}

function makeContractWithTablesJson() {
  return createSqlContract({
    storage: {
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
              columns: ['userId'],
              references: { table: 'user', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
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
    expect(contract.storage.tables).toEqual({});
  });

  it('hydrates JSON storage into the SQL Contract IR class hierarchy', () => {
    const serializer = new PostgresContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithTablesJson());

    expect(contract.storage).toBeInstanceOf(SqlStorage);
    const userTable = contract.storage.tables['user'];
    expect(userTable).toBeInstanceOf(StorageTable);
    expect(userTable?.columns['id']).toBeInstanceOf(StorageColumn);
    expect(userTable?.primaryKey).toBeInstanceOf(PrimaryKey);
    const postTable = contract.storage.tables['post'];
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
        tables: {
          user: {
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          },
        },
      },
    });
    expect(reparsed.storage).not.toHaveProperty('kind');
    expect(reparsed.storage.tables.user).not.toHaveProperty('kind');
    expect(reparsed.storage.tables.user.columns.id).not.toHaveProperty('kind');
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
