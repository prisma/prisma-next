import type { ContractIR } from '@prisma-next/contract/ir';
import { contractIR, irHeader, irMeta } from '@prisma-next/contract/ir';
import { describe, expect, it, vi } from 'vitest';
import { verifyDatabase } from '../src/actions/verify-database';
import type { PrismaNextConfig } from '../src/config-types';
import {
  errorFamilyReadMarkerSqlRequired,
  errorQueryRunnerFactoryRequired,
  errorUnexpected,
} from '../src/errors';

// Helper to create a minimal config for testing
function createTestConfig(overrides?: Partial<PrismaNextConfig>): PrismaNextConfig {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      hook: {} as unknown,
      convertOperationManifest: vi.fn(),
      validateContractIR: vi.fn((contract: unknown) => contract),
      verify: {
        readMarkerSql: () => ({
          sql: 'SELECT core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta FROM prisma_next.contract_marker LIMIT 1',
          params: [],
        }),
      },
      ...overrides?.family,
    },
    target: {
      kind: 'target',
      id: 'postgres',
      family: 'sql',
      manifest: {
        id: 'postgres',
        version: '15.0.0',
      },
      ...overrides?.target,
    },
    adapter: {
      kind: 'adapter',
      id: 'postgres',
      family: 'sql',
      manifest: {
        id: 'postgres',
        version: '15.0.0',
      },
      ...overrides?.adapter,
    },
    ...overrides,
  };
}

// Helper to create a test ContractIR with coreHash (as it would appear after JSON parsing)
function createTestContractIR(
  overrides?: Partial<ContractIR & { coreHash?: string; profileHash?: string }>,
): ContractIR & { coreHash: string; profileHash?: string } {
  const ir = contractIR({
    header: irHeader({
      target: overrides?.target ?? 'postgres',
      targetFamily: 'sql',
      coreHash: overrides?.coreHash ?? 'sha256:test',
      ...(overrides?.profileHash ? { profileHash: overrides.profileHash } : {}),
    }),
    meta: irMeta({}),
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
          },
        },
      },
      ...(overrides?.storage ? { ...overrides.storage } : {}),
    },
    models: overrides?.models ?? {},
    relations: overrides?.relations ?? {},
  });
  // Add coreHash and profileHash as they would appear in JSON-parsed contract
  return {
    ...ir,
    coreHash: overrides?.coreHash ?? 'sha256:test',
    ...(overrides?.profileHash ? { profileHash: overrides.profileHash } : {}),
  } as ContractIR & { coreHash: string; profileHash?: string };
}

describe('verifyDatabase', () => {
  it('verifies database with matching marker', async () => {
    const config = createTestConfig({
      db: {
        queryRunnerFactory: async () => ({
          query: async () => ({
            rows: [
              {
                core_hash: 'sha256:test',
                profile_hash: 'sha256:profile',
                contract_json: null,
                canonical_version: 1,
                updated_at: new Date(),
                app_tag: null,
                meta: null,
              },
            ],
          }),
          close: async () => {},
        }),
      },
    });

    const contractIR = createTestContractIR({ coreHash: 'sha256:test' });

    const result = await verifyDatabase({
      config,
      contractIR,
      dbUrl: 'postgresql://test',
      contractPath: 'src/prisma/contract.json',
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Database matches contract');
    expect(result.contract.coreHash).toBe('sha256:test');
    expect(result.marker?.coreHash).toBe('sha256:test');
  });

  it('returns error when marker is missing', async () => {
    const config = createTestConfig({
      db: {
        queryRunnerFactory: async () => ({
          query: async () => ({
            rows: [],
          }),
          close: async () => {},
        }),
      },
    });

    const contractIR = createTestContractIR();

    const result = await verifyDatabase({
      config,
      contractIR,
      dbUrl: 'postgresql://test',
      contractPath: 'src/prisma/contract.json',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('PN-RTM-3001');
    expect(result.summary).toBe('Marker missing');
    expect(result.marker).toBeUndefined();
  });

  it('returns error when coreHash mismatch', async () => {
    const config = createTestConfig({
      db: {
        queryRunnerFactory: async () => ({
          query: async () => ({
            rows: [
              {
                core_hash: 'sha256:different',
                profile_hash: 'sha256:profile',
                contract_json: null,
                canonical_version: 1,
                updated_at: new Date(),
                app_tag: null,
                meta: null,
              },
            ],
          }),
          close: async () => {},
        }),
      },
    });

    const contractIR = createTestContractIR({ coreHash: 'sha256:test' });

    const result = await verifyDatabase({
      config,
      contractIR,
      dbUrl: 'postgresql://test',
      contractPath: 'src/prisma/contract.json',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('PN-RTM-3002');
    expect(result.summary).toBe('Hash mismatch');
    expect(result.contract.coreHash).toBe('sha256:test');
    expect(result.marker?.coreHash).toBe('sha256:different');
  });

  it('returns error when profileHash mismatch', async () => {
    const config = createTestConfig({
      db: {
        queryRunnerFactory: async () => ({
          query: async () => ({
            rows: [
              {
                core_hash: 'sha256:test',
                profile_hash: 'sha256:different-profile',
                contract_json: null,
                canonical_version: 1,
                updated_at: new Date(),
                app_tag: null,
                meta: null,
              },
            ],
          }),
          close: async () => {},
        }),
      },
    });

    const contractIR = createTestContractIR({
      coreHash: 'sha256:test',
    });
    // Add profileHash to contractIR (it's not part of ContractIR type, but can be present in JSON)
    const contractIRWithProfileHash = {
      ...contractIR,
      profileHash: 'sha256:profile',
    } as ContractIR & { profileHash: string };

    const result = await verifyDatabase({
      config,
      contractIR: contractIRWithProfileHash as ContractIR,
      dbUrl: 'postgresql://test',
      contractPath: 'src/prisma/contract.json',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('PN-RTM-3002');
    expect(result.summary).toBe('Hash mismatch');
  });

  it('returns error when target mismatch', async () => {
    const config = createTestConfig({
      target: {
        kind: 'target',
        id: 'mysql',
        family: 'sql',
        manifest: {
          id: 'mysql',
          version: '8.0.0',
        },
      },
      db: {
        queryRunnerFactory: async () => ({
          query: async () => ({
            rows: [
              {
                core_hash: 'sha256:test',
                profile_hash: 'sha256:profile',
                contract_json: null,
                canonical_version: 1,
                updated_at: new Date(),
                app_tag: null,
                meta: null,
              },
            ],
          }),
          close: async () => {},
        }),
      },
    });

    const contractIR = createTestContractIR({ coreHash: 'sha256:test' });

    const result = await verifyDatabase({
      config,
      contractIR,
      dbUrl: 'postgresql://test',
      contractPath: 'src/prisma/contract.json',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('PN-RTM-3003');
    expect(result.summary).toBe('Target mismatch');
    expect(result.target.expected).toBe('mysql');
    expect(result.target.actual).toBe('postgres');
  });

  it('throws error when queryRunnerFactory is missing', async () => {
    const config = createTestConfig({
      db: {},
    });

    const contractIR = createTestContractIR();

    await expect(
      verifyDatabase({
        config,
        contractIR,
        dbUrl: 'postgresql://test',
        contractPath: 'src/prisma/contract.json',
      }),
    ).rejects.toThrow(errorQueryRunnerFactoryRequired());
  });

  it('throws error when family verify.readMarkerSql is missing', async () => {
    const config = createTestConfig({
      family: {
        kind: 'family',
        id: 'sql',
        hook: {} as unknown,
        convertOperationManifest: vi.fn(),
        validateContractIR: vi.fn((contract: unknown) => contract),
        verify: undefined,
      },
      db: {
        queryRunnerFactory: async () => ({
          query: async () => ({ rows: [] }),
          close: async () => {},
        }),
      },
    });

    const contractIR = createTestContractIR();

    await expect(
      verifyDatabase({
        config,
        contractIR,
        dbUrl: 'postgresql://test',
        contractPath: 'src/prisma/contract.json',
      }),
    ).rejects.toThrow(errorFamilyReadMarkerSqlRequired());
  });

  it('handles contract without profileHash', async () => {
    const config = createTestConfig({
      db: {
        queryRunnerFactory: async () => ({
          query: async () => ({
            rows: [
              {
                core_hash: 'sha256:test',
                profile_hash: 'sha256:profile',
                contract_json: null,
                canonical_version: 1,
                updated_at: new Date(),
                app_tag: null,
                meta: null,
              },
            ],
          }),
          close: async () => {},
        }),
      },
    });

    const contractIR = createTestContractIR({ coreHash: 'sha256:test' });
    // ContractIR doesn't have profileHash, so it should be undefined

    const result = await verifyDatabase({
      config,
      contractIR,
      dbUrl: 'postgresql://test',
      contractPath: 'src/prisma/contract.json',
    });

    expect(result.ok).toBe(true);
    expect(result.contract.profileHash).toBeUndefined();
  });

  it('handles query runner without close method', async () => {
    const config = createTestConfig({
      db: {
        queryRunnerFactory: async () => ({
          query: async () => ({
            rows: [
              {
                core_hash: 'sha256:test',
                profile_hash: 'sha256:profile',
                contract_json: null,
                canonical_version: 1,
                updated_at: new Date(),
                app_tag: null,
                meta: null,
              },
            ],
          }),
          // No close method
        }),
      },
    });

    const contractIR = createTestContractIR({ coreHash: 'sha256:test' });

    const result = await verifyDatabase({
      config,
      contractIR,
      dbUrl: 'postgresql://test',
      contractPath: 'src/prisma/contract.json',
    });

    expect(result.ok).toBe(true);
  });

  it('handles query result with rows but undefined first row', async () => {
    const config = createTestConfig({
      db: {
        queryRunnerFactory: async () => ({
          query: async () => ({
            rows: [undefined, {}],
          }),
          close: async () => {},
        }),
      },
    });

    const contractIR = createTestContractIR();

    await expect(
      verifyDatabase({
        config,
        contractIR,
        dbUrl: 'postgresql://test',
        contractPath: 'src/prisma/contract.json',
      }),
    ).rejects.toThrow(errorUnexpected('Query returned rows but first row is undefined'));
  });

  it('handles invalid contract structure (missing coreHash or target)', async () => {
    const config = createTestConfig({
      db: {
        queryRunnerFactory: async () => ({
          query: async () => ({
            rows: [],
          }),
          close: async () => {},
        }),
      },
    });

    // Create invalid contractIR (missing coreHash/target)
    // This simulates a contract that was parsed from JSON but is missing required fields
    const invalidContractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      // Missing target and coreHash
      models: {},
      relations: {},
      storage: { tables: {} },
      extensions: {},
      capabilities: {},
      meta: {},
      sources: {},
    } as unknown as ContractIR;

    await expect(
      verifyDatabase({
        config,
        contractIR: invalidContractIR,
        dbUrl: 'postgresql://test',
        contractPath: 'src/prisma/contract.json',
      }),
    ).rejects.toThrow(errorUnexpected('Invalid contract structure'));
  });

  it('handles non-Error exceptions', async () => {
    const config = createTestConfig({
      db: {
        queryRunnerFactory: async () => {
          throw 'String error';
        },
      },
    });

    const contractIR = createTestContractIR();

    await expect(
      verifyDatabase({
        config,
        contractIR,
        dbUrl: 'postgresql://test',
        contractPath: 'src/prisma/contract.json',
      }),
    ).rejects.toThrow('Failed to verify database: String error');
  });
});
