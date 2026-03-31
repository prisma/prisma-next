import type { ExecutionPlan } from '@prisma-next/contract/types';
import { coreHash } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { AdapterProfile } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { SqlFamilyAdapter } from '../src/sql-family-adapter';

// Minimal test contract
const testContract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  storageHash: coreHash('sha256:test-hash'),
  models: {},
  relations: {},
  storage: { tables: {} },
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
  mappings: {},
};

const testProfile: AdapterProfile = {
  id: 'test/default@1',
  target: 'postgres',
  capabilities: {},
  codecs: () => {
    throw new Error('not needed in test');
  },
  readMarkerStatement: () => ({
    sql: 'SELECT core_hash, profile_hash FROM prisma_contract.marker WHERE id = $1',
    params: [1],
  }),
};

describe('SqlFamilyAdapter', () => {
  it('creates adapter with contract and marker reader', () => {
    const adapter = new SqlFamilyAdapter(testContract, testProfile);

    expect(adapter.contract).toBe(testContract);
    expect(adapter.markerReader).toBeDefined();
    expect(adapter.markerReader.readMarkerStatement).toBeDefined();
  });

  it('delegates readMarkerStatement to adapter profile', () => {
    const adapter = new SqlFamilyAdapter(testContract, testProfile);
    const stmt = adapter.markerReader.readMarkerStatement();

    expect(stmt.sql).toContain('prisma_contract.marker');
    expect(stmt.params).toEqual([1]);
  });

  it('validates plan with matching target and hash', () => {
    const adapter = new SqlFamilyAdapter(testContract, testProfile);
    const plan: ExecutionPlan = {
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test-hash',
        lane: 'sql',
        paramDescriptors: [],
      },
      sql: 'SELECT 1',
      params: [],
    };

    // Should not throw
    expect(() => adapter.validatePlan(plan, testContract)).not.toThrow();
  });

  it('throws on plan target mismatch', () => {
    const adapter = new SqlFamilyAdapter(testContract, testProfile);
    const plan: ExecutionPlan = {
      meta: {
        target: 'mysql', // Wrong target
        storageHash: 'sha256:test-hash',
        lane: 'sql',
        paramDescriptors: [],
      },
      sql: 'SELECT 1',
      params: [],
    };

    expect(() => adapter.validatePlan(plan, testContract)).toThrow(
      'Plan target does not match runtime target',
    );
  });

  it('throws on plan storageHash mismatch', () => {
    const adapter = new SqlFamilyAdapter(testContract, testProfile);
    const plan: ExecutionPlan = {
      meta: {
        target: 'postgres',
        storageHash: 'sha256:different-hash', // Wrong hash
        lane: 'sql',
        paramDescriptors: [],
      },
      sql: 'SELECT 1',
      params: [],
    };

    expect(() => adapter.validatePlan(plan, testContract)).toThrow(
      'Plan storage hash does not match runtime contract',
    );
  });
});
