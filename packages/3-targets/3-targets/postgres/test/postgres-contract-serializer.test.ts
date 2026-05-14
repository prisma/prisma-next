import { createSqlContract } from '@prisma-next/contract/testing';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import postgresTargetDescriptor from '../src/exports/control';

function makeValidContractJson() {
  return createSqlContract();
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

  it('rejects an invalid contract (family-shared structural validation runs)', () => {
    const serializer = new PostgresContractSerializer();
    const bad = { ...makeValidContractJson(), targetFamily: 'mongo' };
    expect(() => serializer.deserializeContract(bad)).toThrow();
  });

  it('serializeContract round-trips a JSON-clean contract', () => {
    const serializer = new PostgresContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());
    const json = serializer.serializeContract(contract);
    expect(JSON.parse(JSON.stringify(json))).toMatchObject({
      targetFamily: 'sql',
      storage: { tables: {} },
    });
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
