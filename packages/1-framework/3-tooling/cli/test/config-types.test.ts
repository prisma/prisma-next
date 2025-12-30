import type { PrismaNextConfig } from '@prisma-next/core-control-plane/config-types';
import { defineConfig } from '@prisma-next/core-control-plane/config-types';
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
      manifest: { id: 'sql', version: '0.0.1' },
      hook: mockHook,
      create: () => ({
        familyId: 'sql',
        validateContractIR: (contract: unknown) => contract,
        verify: async () => ({
          ok: true,
          summary: 'test',
          contract: { coreHash: 'test' },
          target: { expected: 'postgres' },
          timings: { total: 0 },
        }),
        schemaVerify: async () => ({
          ok: true,
          summary: 'test',
          contract: { coreHash: 'test' },
          target: { expected: 'postgres' },
          schema: { issues: [] },
          timings: { total: 0 },
        }),
        sign: async () => ({
          ok: true,
          summary: 'test',
          contract: { coreHash: 'test' },
          target: { expected: 'postgres' },
          marker: { created: true, updated: false },
          timings: { total: 0 },
        }),
        introspect: async () => ({ tables: {}, extensions: [] }),
        emitContract: async () => ({
          contractJson: '{}',
          contractDts: '',
          coreHash: 'test',
          profileHash: 'test',
        }),
      }),
    },
    target: {
      kind: 'target',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      manifest: { id: 'postgres', version: '1.0.0' },
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    adapter: {
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      manifest: { id: 'postgres', version: '1.0.0' },
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    driver: {
      kind: 'driver',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      manifest: { id: 'postgres', version: '1.0.0' },
      create: async () => ({
        targetId: 'postgres',
        query: async () => ({ rows: [] }),
        close: async () => {},
      }),
    },
    extensions: [],
  };

  it('returns the config object unchanged when no contract', () => {
    const result = defineConfig(baseConfig);
    expect(result).toBe(baseConfig);
    expect(result.family.familyId).toBe('sql');
    expect(result.target.id).toBe('postgres');
    expect(result.adapter.id).toBe('postgres');
  });

  it('normalizes contract config with default output and types', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: { target: 'postgres' },
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('src/prisma/contract.json');
    expect(result.contract?.types).toBe('src/prisma/contract.d.ts');
  });

  it('normalizes contract config with custom output and default types', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: { target: 'postgres' },
        output: 'custom/contract.json',
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('custom/contract.json');
    expect(result.contract?.types).toBe('custom/contract.d.ts');
  });

  it('normalizes contract config with custom output (non-json) and default types', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: { target: 'postgres' },
        output: 'custom/contract',
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('custom/contract');
    expect(result.contract?.types).toBe('custom/contract.d.ts');
  });

  it('normalizes contract config with custom output and types', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: { target: 'postgres' },
        output: 'custom/contract.json',
        types: 'custom/contract.d.ts',
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('custom/contract.json');
    expect(result.contract?.types).toBe('custom/contract.d.ts');
  });

  it('validates contract source accepts object', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: { target: 'postgres' },
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.source).toEqual({ target: 'postgres' });
  });

  it('validates contract source accepts string', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: 'test',
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.source).toBe('test');
  });

  it('validates contract source accepts number', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: 42,
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.source).toBe(42);
  });

  it('validates contract source accepts boolean', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: true,
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.source).toBe(true);
  });

  it('validates contract source accepts null', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: null,
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.source).toBeNull();
  });

  it('validates contract source accepts function', () => {
    const sourceFn = () => ({ target: 'postgres' });
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: sourceFn,
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.source).toBe(sourceFn);
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
      'Config.contract.source must be a value (object, string, number, boolean, null) or a function',
    );
  });
});
