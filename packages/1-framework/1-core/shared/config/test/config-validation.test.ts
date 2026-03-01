import type { ContractIR } from '@prisma-next/contract/ir';
import { ok } from '@prisma-next/utils/result';
import { describe, expect, it, vi } from 'vitest';
import { defineConfig, type PrismaNextConfig } from '../src/config-types';
import { validateConfig } from '../src/config-validation';
import { ConfigValidationError } from '../src/errors';
import type { ControlDriverInstance, ControlFamilyInstance } from '../src/types';

const mockHook = {
  id: 'sql',
  validateTypes: () => {},
  validateStructure: () => {},
  generateContractTypes: () => '',
};

function createValidConfig(overrides: Record<string, unknown> = {}): PrismaNextConfig {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      hook: mockHook,
      create: () => ({ familyId: 'sql' }) as unknown as ControlFamilyInstance<'sql'>,
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
      create: async () =>
        ({
          familyId: 'sql',
          targetId: 'postgres',
          query: async () => ({ rows: [] }),
          close: async () => {},
        }) as ControlDriverInstance<'sql', 'postgres'>,
    },
    extensionPacks: [],
    ...overrides,
  } as PrismaNextConfig;
}

describe('validateConfig', () => {
  it('validates valid config', () => {
    expect(() => validateConfig(createValidConfig())).not.toThrow();
  });

  it('throws for non-object config', () => {
    expect(() => validateConfig(null)).toThrow(ConfigValidationError);
    expect(() => validateConfig(undefined)).toThrow(ConfigValidationError);
    expect(() => validateConfig('invalid')).toThrow(ConfigValidationError);
  });

  it('throws when contract source is not a provider function', () => {
    const config = createValidConfig({
      contract: {
        source: { kind: 'psl', schemaPath: './schema.prisma' },
      },
    });

    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });
});

describe('defineConfig', () => {
  it('returns config unchanged when contract is absent', () => {
    const config = createValidConfig();
    const result = defineConfig(config);
    expect(result).toBe(config);
  });

  it('applies default output path when contract output is missing', () => {
    const sourceProvider = async () => ok({ targetFamily: 'sql' } as ContractIR);
    const config = createValidConfig({
      contract: {
        source: sourceProvider,
      },
    });

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('src/prisma/contract.json');
  });

  it('preserves custom output path', () => {
    const sourceProvider = async () => ok({ targetFamily: 'sql' } as ContractIR);
    const config = createValidConfig({
      contract: {
        source: sourceProvider,
        output: 'custom/contract.json',
      },
    });

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('custom/contract.json');
  });

  it('throws when contract source is not a function', () => {
    const config = createValidConfig({
      contract: {
        source: 'invalid',
      },
    }) as unknown as PrismaNextConfig;

    expect(() => defineConfig(config)).toThrow(
      'Config.contract.source must be a provider function',
    );
  });

  it('throws for invalid top-level shape', () => {
    const invalidConfig = { family: null } as unknown as PrismaNextConfig;
    expect(() => defineConfig(invalidConfig)).toThrow('Config validation failed');
  });

  it('validates family create is function', () => {
    const config = createValidConfig({
      family: {
        kind: 'family',
        id: 'sql',
        familyId: 'sql',
        version: '0.0.1',
        hook: mockHook,
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });
});
