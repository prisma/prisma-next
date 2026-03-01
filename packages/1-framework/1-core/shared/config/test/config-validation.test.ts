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

type RawConfigOverrides = Record<string, unknown> & {
  family?: Record<string, unknown>;
  target?: Record<string, unknown>;
  adapter?: Record<string, unknown>;
  driver?: Record<string, unknown>;
};

function createValidRawConfig(overrides: RawConfigOverrides = {}) {
  const { family, target, adapter, driver, ...rest } = overrides;

  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      hook: {},
      create: vi.fn(),
      ...(family as Record<string, unknown> | undefined),
    },
    target: {
      kind: 'target',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      create: vi.fn(),
      ...(target as Record<string, unknown> | undefined),
    },
    adapter: {
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      create: vi.fn(),
      ...(adapter as Record<string, unknown> | undefined),
    },
    driver: {
      kind: 'driver',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      create: vi.fn(),
      ...(driver as Record<string, unknown> | undefined),
    },
    ...rest,
  };
}

function expectFieldError(config: unknown, field: string) {
  try {
    validateConfig(config);
    throw new Error('expected validateConfig to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as ConfigValidationError).field).toBe(field);
  }
}

describe('validateConfig', () => {
  it('validates valid config', () => {
    expect(() => validateConfig(createValidRawConfig())).not.toThrow();
  });

  it('throws for non-object config', () => {
    expectFieldError(null, 'object');
    expectFieldError(undefined, 'object');
    expectFieldError('invalid', 'object');
  });

  it('throws when required top-level descriptors are missing', () => {
    expectFieldError({ target: {}, adapter: {} }, 'family');
    expectFieldError({ family: {}, adapter: {} }, 'target');
    expectFieldError({ family: {}, target: {} }, 'adapter');
  });

  it('validates family descriptor fields', () => {
    expectFieldError(createValidRawConfig({ family: { kind: 'invalid' } }), 'family.kind');
    expectFieldError(createValidRawConfig({ family: { familyId: 123 } }), 'family.familyId');
    expectFieldError(createValidRawConfig({ family: { version: 123 } }), 'family.version');
    expectFieldError(createValidRawConfig({ family: { hook: undefined } }), 'family.hook');
    expectFieldError(createValidRawConfig({ family: { create: 'invalid' } }), 'family.create');
  });

  it('validates target descriptor fields', () => {
    expectFieldError(createValidRawConfig({ target: { kind: 'invalid' } }), 'target.kind');
    expectFieldError(createValidRawConfig({ target: { id: 123 } }), 'target.id');
    expectFieldError(createValidRawConfig({ target: { familyId: 123 } }), 'target.familyId');
    expectFieldError(createValidRawConfig({ target: { version: 123 } }), 'target.version');
    expectFieldError(createValidRawConfig({ target: { targetId: 123 } }), 'target.targetId');
    expectFieldError(createValidRawConfig({ target: { create: 'invalid' } }), 'target.create');
  });

  it('validates target family compatibility', () => {
    expectFieldError(
      createValidRawConfig({
        family: { familyId: 'sql' },
        target: { familyId: 'document' },
      }),
      'target.familyId',
    );
  });

  it('validates adapter descriptor fields', () => {
    expectFieldError(createValidRawConfig({ adapter: { kind: 'invalid' } }), 'adapter.kind');
    expectFieldError(createValidRawConfig({ adapter: { id: 123 } }), 'adapter.id');
    expectFieldError(createValidRawConfig({ adapter: { familyId: 123 } }), 'adapter.familyId');
    expectFieldError(createValidRawConfig({ adapter: { version: 123 } }), 'adapter.version');
    expectFieldError(createValidRawConfig({ adapter: { targetId: 123 } }), 'adapter.targetId');
    expectFieldError(createValidRawConfig({ adapter: { create: 'invalid' } }), 'adapter.create');
  });

  it('validates adapter family and target compatibility', () => {
    expectFieldError(
      createValidRawConfig({
        family: { familyId: 'sql' },
        adapter: { familyId: 'document' },
      }),
      'adapter.familyId',
    );

    expectFieldError(
      createValidRawConfig({
        target: { targetId: 'postgres' },
        adapter: { targetId: 'mysql' },
      }),
      'adapter.targetId',
    );
  });

  it('validates extensionPacks collection and extension descriptors', () => {
    expectFieldError(createValidRawConfig({ extensionPacks: 'invalid' }), 'extensionPacks');
    expectFieldError(createValidRawConfig({ extensionPacks: ['invalid'] }), 'extensionPacks[]');
    expectFieldError(
      createValidRawConfig({
        extensionPacks: [{ kind: 'invalid', id: 'ext', familyId: 'sql', targetId: 'postgres' }],
      }),
      'extensionPacks[].kind',
    );
    expectFieldError(
      createValidRawConfig({
        extensionPacks: [{ kind: 'extension', id: 123, familyId: 'sql', targetId: 'postgres' }],
      }),
      'extensionPacks[].id',
    );
    expectFieldError(
      createValidRawConfig({
        extensionPacks: [{ kind: 'extension', id: 'ext', familyId: 123, targetId: 'postgres' }],
      }),
      'extensionPacks[].familyId',
    );
    expectFieldError(
      createValidRawConfig({
        extensionPacks: [{ kind: 'extension', id: 'ext', familyId: 'sql', version: 123 }],
      }),
      'extensionPacks[].version',
    );
    expectFieldError(
      createValidRawConfig({
        extensionPacks: [
          {
            kind: 'extension',
            id: 'ext',
            familyId: 'document',
            targetId: 'postgres',
            version: '0.0.1',
            create: vi.fn(),
          },
        ],
      }),
      'extensionPacks[].familyId',
    );
    expectFieldError(
      createValidRawConfig({
        extensionPacks: [
          {
            kind: 'extension',
            id: 'ext',
            familyId: 'sql',
            targetId: 123,
            version: '0.0.1',
            create: vi.fn(),
          },
        ],
      }),
      'extensionPacks[].targetId',
    );
    expectFieldError(
      createValidRawConfig({
        extensionPacks: [
          {
            kind: 'extension',
            id: 'ext',
            familyId: 'sql',
            targetId: 'mysql',
            version: '0.0.1',
            create: vi.fn(),
          },
        ],
      }),
      'extensionPacks[].targetId',
    );
    expectFieldError(
      createValidRawConfig({
        extensionPacks: [
          {
            kind: 'extension',
            id: 'ext',
            familyId: 'sql',
            targetId: 'postgres',
            version: '0.0.1',
            create: 'invalid',
          },
        ],
      }),
      'extensionPacks[].create',
    );
  });

  it('rejects legacy extensions key', () => {
    expectFieldError(
      createValidRawConfig({
        extensions: [],
      }),
      'extensions',
    );
  });

  it('validates driver descriptor fields and compatibility', () => {
    expectFieldError(createValidRawConfig({ driver: { kind: 'invalid' } }), 'driver.kind');
    expectFieldError(createValidRawConfig({ driver: { id: 123 } }), 'driver.id');
    expectFieldError(createValidRawConfig({ driver: { version: 123 } }), 'driver.version');
    expectFieldError(createValidRawConfig({ driver: { familyId: 123 } }), 'driver.familyId');
    expectFieldError(createValidRawConfig({ driver: { familyId: 'document' } }), 'driver.familyId');
    expectFieldError(createValidRawConfig({ driver: { targetId: 123 } }), 'driver.targetId');
    expectFieldError(createValidRawConfig({ driver: { targetId: 'mysql' } }), 'driver.targetId');
    expectFieldError(createValidRawConfig({ driver: { create: 'invalid' } }), 'driver.create');
  });

  it('validates contract shape and source provider', () => {
    expectFieldError(createValidRawConfig({ contract: 'invalid' }), 'contract');
    expectFieldError(createValidRawConfig({ contract: {} }), 'contract.source');
    expectFieldError(
      createValidRawConfig({
        contract: { source: { kind: 'psl', schemaPath: './schema.prisma' } },
      }),
      'contract.source',
    );
    expectFieldError(
      createValidRawConfig({
        contract: {
          source: async () => ok({ targetFamily: 'sql' } as ContractIR),
          output: 123,
        },
      }),
      'contract.output',
    );
  });

  it('accepts valid optional sections', () => {
    const config = createValidRawConfig({
      extensionPacks: [
        {
          kind: 'extension',
          id: 'pgvector',
          familyId: 'sql',
          targetId: 'postgres',
          version: '0.0.1',
          create: vi.fn(),
        },
      ],
      contract: {
        source: async () => ok({ targetFamily: 'sql' } as ContractIR),
        output: 'src/prisma/contract.json',
      },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });
});

describe('ConfigValidationError', () => {
  it('uses default message when why is omitted', () => {
    const error = new ConfigValidationError('family');
    expect(error.field).toBe('family');
    expect(error.why).toBe('Config must have a "family" field');
    expect(error.message).toBe('Config must have a "family" field');
  });

  it('uses explicit why when provided', () => {
    const error = new ConfigValidationError('family', 'Custom reason');
    expect(error.field).toBe('family');
    expect(error.why).toBe('Custom reason');
    expect(error.message).toBe('Custom reason');
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
