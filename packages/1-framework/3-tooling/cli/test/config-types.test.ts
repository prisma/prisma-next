import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { PrismaNextConfig } from '@prisma-next/core-control-plane/config-types';
import {
  defineConfig,
  prismaContract,
  typescriptContract,
} from '@prisma-next/core-control-plane/config-types';
import { ok } from '@prisma-next/utils/result';
import { describe, expect, it } from 'vitest';

describe('defineConfig', () => {
  const mockHook = {
    id: 'sql',
    validateTypes: () => {},
    validateStructure: () => {},
    generateContractTypes: () => '',
  };

  const baseConfig: PrismaNextConfig = {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      hook: mockHook,
      create: () => ({
        familyId: 'sql',
        validateContractIR: (contract: unknown) => contract as ContractIR,
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
        emitContract: async () => ({
          contractJson: '{}',
          contractDts: '',
          storageHash: 'test',
          profileHash: 'test',
        }),
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
    const sourceProvider = async () => ok({ targetFamily: 'sql' } as ContractIR);
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: sourceProvider,
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('src/prisma/contract.json');
  });

  it('normalizes contract config with custom output', () => {
    const sourceProvider = async () => ok({ targetFamily: 'sql' } as ContractIR);
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: sourceProvider,
        output: 'custom/contract.json',
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('custom/contract.json');
  });

  it('validates contract source accepts provider function', () => {
    const sourceProvider = async () => ok({ targetFamily: 'sql' } as ContractIR);
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: sourceProvider,
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.source).toBe(sourceProvider);
  });

  it('throws when source is not a provider function', () => {
    const config = {
      ...baseConfig,
      contract: {
        source: 'invalid' as unknown,
      },
    } as PrismaNextConfig;

    expect(() => defineConfig(config)).toThrow(
      'Config.contract.source must be a provider function returning Promise<Result<ContractIR, Diagnostics>>',
    );
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
    } as PrismaNextConfig;

    expect(() => defineConfig(config)).toThrow(
      'Config.contract.source must be a provider function returning Promise<Result<ContractIR, Diagnostics>>',
    );
  });

  it('builds TypeScript contract config via helper utility', async () => {
    const contract = { targetFamily: 'sql' } as ContractIR;
    const config = typescriptContract(contract, 'output/contract.json');
    const result = await config.source();

    expect(config.output).toBe('output/contract.json');
    expect(result.ok).toBe(true);
  });

  it('builds Prisma contract config via helper utility', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prisma-next-config-types-'));
    const schemaPath = join(dir, 'schema.prisma');
    writeFileSync(schemaPath, 'model User { id Int @id }', 'utf-8');

    try {
      const config = prismaContract(
        schemaPath,
        async ({ schema, schemaPath: pathFromResolver }) => {
          expect(schema).toContain('model User');
          expect(pathFromResolver).toBe(schemaPath);
          return ok({ targetFamily: 'sql' } as ContractIR);
        },
      );
      const result = await config.source();

      expect(result.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns diagnostics when Prisma schema path cannot be read', async () => {
    const config = prismaContract('/missing/path/schema.prisma', async () =>
      ok({ targetFamily: 'sql' } as ContractIR),
    );
    const result = await config.source();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.summary).toContain('Failed to read Prisma schema');
      expect(result.failure.diagnostics[0]?.code).toBe('PSL_SCHEMA_READ_FAILED');
    }
  });
});
