import { buildNamespacedEnums, type NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { createContract } from '@prisma-next/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import postgresStatic, { type PostgresStaticContext } from '../src/static/postgres-static';

const mocks = vi.hoisted(() => ({
  deserializeContract: vi.fn(),
}));

vi.mock('@prisma-next/target-postgres/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma-next/target-postgres/runtime')>();
  return {
    ...actual,
    PostgresContractSerializer: class {
      deserializeContract(json: unknown) {
        return mocks.deserializeContract(json);
      }
    },
  };
});

const contract = createContract<SqlStorage>();

describe('postgresStatic({ contractJson })', () => {
  beforeEach(() => {
    mocks.deserializeContract.mockReset();
    mocks.deserializeContract.mockReturnValue(contract);
  });

  it('returns context, contract, enums, sql, and raw', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    expect(result.context).toBeDefined();
    expect(result.contract).toBeDefined();
    expect(result.enums).toBeDefined();
    expect(result.sql).toBeDefined();
    expect(result.raw).toBeDefined();
  });

  it('context carries the contract (merged capabilities view)', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    expect(result.context.contract).toBeDefined();
    expect(result.context.contract.target).toBe(contract.target);
  });

  it('context carries the codec registry (standard codecs present)', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    expect(result.context.contractCodecs).toBeDefined();
  });

  it('passes the contractJson through the deserializer', () => {
    const rawJson = { target: 'postgres' };
    postgresStatic({ contractJson: rawJson });
    expect(mocks.deserializeContract).toHaveBeenCalledWith(rawJson);
  });

  it('sql is a function (builder is present)', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    expect(typeof result.sql).toBe('object');
  });

  it('raw is a tagged template function', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    expect(typeof result.raw).toBe('function');
  });

  it('enums matches what buildNamespacedEnums produces', () => {
    const result = postgresStatic<typeof contract>({ contractJson: contract });
    const allNamespaced = buildNamespacedEnums(contract.domain) as NamespacedEnums<
      Contract<SqlStorage>
    >;

    expect(result.enums).toMatchObject(allNamespaced);
  });

  it('PostgresStaticContext type exposes context, contract, enums, sql, raw', () => {
    const result: PostgresStaticContext<typeof contract> = postgresStatic<typeof contract>({
      contractJson: contract,
    });
    expect(result).toBeDefined();
  });
});
