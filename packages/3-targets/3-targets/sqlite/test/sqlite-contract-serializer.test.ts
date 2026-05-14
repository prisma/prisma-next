import { createSqlContract } from '@prisma-next/contract/testing';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import { describe, expect, it } from 'vitest';
import sqliteControlTargetDescriptor from '../src/core/control-target';
import { SqliteContractSerializer } from '../src/core/sqlite-contract-serializer';

function makeValidContractJson() {
  return createSqlContract({ target: 'sqlite' });
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
    expect(contract.storage.tables).toEqual({});
  });

  it('rejects an invalid contract (family-shared structural validation runs)', () => {
    const serializer = new SqliteContractSerializer();
    const bad = { ...makeValidContractJson(), targetFamily: 'mongo' };
    expect(() => serializer.deserializeContract(bad)).toThrow();
  });

  it('serializeContract round-trips a JSON-clean contract', () => {
    const serializer = new SqliteContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());
    const json = serializer.serializeContract(contract);
    expect(JSON.parse(JSON.stringify(json))).toMatchObject({
      targetFamily: 'sql',
      storage: { tables: {} },
    });
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
