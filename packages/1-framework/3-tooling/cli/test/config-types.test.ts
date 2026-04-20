import type { PrismaNextConfig } from '@prisma-next/config/config-types';
import { defineConfig } from '@prisma-next/config/config-types';
import type { Contract } from '@prisma-next/contract/types';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import { ok } from '@prisma-next/utils/result';
import { describe, expect, it } from 'vitest';

describe('defineConfig', () => {
  const createSourceProvider = (authoritativeInputs = { kind: 'moduleGraph' as const }) => ({
    authoritativeInputs,
    load: async () => ok({ targetFamily: 'sql' } as Contract),
  });

  const mockHook = {
    id: 'sql',
    generateStorageType: () => '{}',
    generateModelStorageType: () => '{}',
    getFamilyImports: () => [] as string[],
    getFamilyTypeAliases: () => '',
    getTypeMapsExpression: () => 'never',
    getContractWrapper: (base: string, tm: string) =>
      `export type Contract = ${base} & { typeMaps: ${tm} };`,
  };

  const baseConfig: PrismaNextConfig = {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      emission: mockHook,
      create: () => ({
        familyId: 'sql',
        validateContract: (contract: unknown) => contract as Contract,
        verify: async () => ({
          ok: true,
          summary: 'test',
          contract: { storageHash: 'test' },
          target: { expected: 'postgres' },
          timings: { total: 0 },
        }),
        schemaVerify: async () => ({
          ok: true,
          summary: 'test',
          contract: { storageHash: 'test' },
          target: { expected: 'postgres' },
          schema: {
            issues: [],
            root: {
              status: 'pass' as const,
              kind: 'root',
              name: 'root',
              contractPath: '',
              code: '',
              message: '',
              expected: null,
              actual: null,
              children: [],
            },
            counts: { pass: 0, warn: 0, fail: 0, totalNodes: 0 },
          },
          timings: { total: 0 },
        }),
        sign: async () => ({
          ok: true,
          summary: 'test',
          contract: { storageHash: 'test' },
          target: { expected: 'postgres' },
          marker: { created: true, updated: false },
          timings: { total: 0 },
        }),
        readMarker: async () => null,
        introspect: async () => ({ tables: {}, extensionPacks: [] }),
      }),
    },
    target: {
      kind: 'target',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    adapter: {
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    driver: {
      kind: 'driver',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      create: async () => ({
        familyId: 'sql',
        targetId: 'postgres',
        query: async () => ({ rows: [] }),
        close: async () => {},
      }),
    },
    extensionPacks: [],
  };

  it('returns the config object unchanged when no contract', () => {
    const result = defineConfig(baseConfig);
    expect(result).toBe(baseConfig);
    expect(result.family.familyId).toBe('sql');
    expect(result.target.id).toBe('postgres');
    expect(result.adapter.id).toBe('postgres');
  });

  it('normalizes contract config with default output', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: createSourceProvider(),
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('src/prisma/contract.json');
  });

  it('normalizes contract config with custom output', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: createSourceProvider({
          kind: 'paths',
          paths: ['./schema.prisma'],
        }),
        output: 'custom/contract.json',
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('custom/contract.json');
    expect(result.contract?.source.authoritativeInputs).toEqual({
      kind: 'paths',
      paths: ['./schema.prisma'],
    });
  });

  it('preserves contract authoritative inputs', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: createSourceProvider(),
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.source.authoritativeInputs).toEqual({ kind: 'moduleGraph' });
  });

  it('validates contract source accepts provider objects', () => {
    const sourceProvider = createSourceProvider();
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: sourceProvider,
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.source).toBe(sourceProvider);
  });

  it('throws when source is not a provider object', () => {
    const config = {
      ...baseConfig,
      contract: {
        source: 'invalid' as unknown,
      },
    } as unknown as PrismaNextConfig;

    expect(() => defineConfig(config)).toThrow('Config validation failed');
  });

  it('throws error on invalid config structure', () => {
    const invalidConfig = {
      family: null,
    } as unknown as PrismaNextConfig;

    expect(() => defineConfig(invalidConfig)).toThrow('Config validation failed');
  });

  it('throws error on invalid contract source type', () => {
    const config = {
      ...baseConfig,
      contract: {
        source: undefined as unknown,
      },
    } as unknown as PrismaNextConfig;

    expect(() => defineConfig(config)).toThrow('Config validation failed');
  });

  it('builds TypeScript contract config via helper utility', async () => {
    const contract = { targetFamily: 'sql' } as Contract;
    const config = typescriptContract(contract, 'output/contract.json');
    const result = await config.source.load({
      composedExtensionPacks: [],
      scalarTypeDescriptors: new Map(),
      authoringContributions: { field: {}, type: {} },
      codecLookup: { get: () => undefined },
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
    });

    expect(config.output).toBe('output/contract.json');
    expect(config.source.authoritativeInputs).toEqual({ kind: 'moduleGraph' });
    expect(result.ok).toBe(true);
    expect(result.assertOk()).toBe(contract);
  });
});
