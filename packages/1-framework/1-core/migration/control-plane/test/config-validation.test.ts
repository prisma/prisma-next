import { describe, expect, it, vi } from 'vitest';
import { validateConfig } from '../src/config-validation';
import { CliStructuredError } from '../src/errors';

type CreateValidConfigOverrides = Record<string, unknown> & {
  family?: Record<string, unknown>;
  target?: Record<string, unknown>;
  adapter?: Record<string, unknown>;
  driver?: Record<string, unknown>;
};

// Helper to create a minimal valid config for testing
function createValidConfig(overrides: CreateValidConfigOverrides = {}) {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      manifest: { id: 'sql', version: '0.0.1' },
      hook: {},
      create: vi.fn(() => ({
        familyId: 'sql',
        validateContractIR: vi.fn(),
        verify: vi.fn(),
        schemaVerify: vi.fn(),
        introspect: vi.fn(),
      })),
      ...(overrides.family as Record<string, unknown> | undefined),
    },
    target: {
      kind: 'target',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      manifest: {
        id: 'postgres',
        version: '15.0.0',
      },
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
      ...(overrides.target as Record<string, unknown> | undefined),
    },
    adapter: {
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      manifest: {
        id: 'postgres',
        version: '15.0.0',
      },
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
      ...(overrides.adapter as Record<string, unknown> | undefined),
    },
    driver: {
      kind: 'driver',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      manifest: {
        id: 'postgres',
        version: '15.0.0',
      },
      create: async () => ({
        targetId: 'postgres',
        query: async () => ({ rows: [] }),
        close: async () => {},
      }),
      ...(overrides.driver as Record<string, unknown> | undefined),
    },
    ...overrides,
  };
}

describe('validateConfig', () => {
  it('validates valid config', () => {
    const config = createValidConfig();
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('throws error when config is not an object', () => {
    expect(() => validateConfig(null)).toThrow(CliStructuredError);
    expect(() => validateConfig(undefined)).toThrow(CliStructuredError);
    expect(() => validateConfig('string')).toThrow(CliStructuredError);
    expect(() => validateConfig(123)).toThrow(CliStructuredError);
  });

  it('throws error when family is missing', () => {
    const config = { target: {}, adapter: {} };
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when target is missing', () => {
    const config = { family: {}, adapter: {} };
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when adapter is missing', () => {
    const config = { family: {}, target: {} };
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when family.kind is not "family"', () => {
    const config = createValidConfig({
      family: {
        kind: 'invalid',
        id: 'sql',
        hook: {},
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when family.familyId is not a string', () => {
    const config = createValidConfig({
      family: {
        kind: 'family',
        familyId: 123,
        manifest: { id: 'sql', version: '0.0.1' },
        hook: {},
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when family.hook is missing or not an object', () => {
    const config1 = createValidConfig({
      family: {
        kind: 'family',
        id: 'sql',
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config1)).toThrow(CliStructuredError);

    const config2 = createValidConfig({
      family: {
        kind: 'family',
        id: 'sql',
        hook: 'not-an-object',
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config2)).toThrow(CliStructuredError);
  });

  it('throws error when target.kind is not "target"', () => {
    const config = createValidConfig({
      target: {
        kind: 'invalid',
        id: 'postgres',
        family: 'sql',
        manifest: {},
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when target.id is not a string', () => {
    const config = createValidConfig({
      target: {
        kind: 'target',
        id: 123,
        family: 'sql',
        manifest: {},
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when target.familyId is not a string', () => {
    const config = createValidConfig({
      target: {
        kind: 'target',
        id: 'postgres',
        family: 123,
        manifest: {},
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when target.manifest is missing or not an object', () => {
    const config1 = createValidConfig({
      target: {
        kind: 'target',
        id: 'postgres',
        family: 'sql',
      },
    });
    expect(() => validateConfig(config1)).toThrow(CliStructuredError);

    const config2 = createValidConfig({
      target: {
        kind: 'target',
        id: 'postgres',
        family: 'sql',
        manifest: 'not-an-object',
      },
    });
    expect(() => validateConfig(config2)).toThrow(CliStructuredError);
  });

  it('throws error when adapter.kind is not "adapter"', () => {
    const config = createValidConfig({
      adapter: {
        kind: 'invalid',
        id: 'postgres',
        family: 'sql',
        manifest: {},
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when adapter.id is not a string', () => {
    const config = createValidConfig({
      adapter: {
        kind: 'adapter',
        id: 123,
        family: 'sql',
        manifest: {},
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when adapter.familyId is not a string', () => {
    const config = createValidConfig({
      adapter: {
        kind: 'adapter',
        id: 'postgres',
        family: 123,
        manifest: {},
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when adapter.manifest is missing or not an object', () => {
    const config1 = createValidConfig({
      adapter: {
        kind: 'adapter',
        id: 'postgres',
        family: 'sql',
      },
    });
    expect(() => validateConfig(config1)).toThrow(CliStructuredError);

    const config2 = createValidConfig({
      adapter: {
        kind: 'adapter',
        id: 'postgres',
        family: 'sql',
        manifest: 'not-an-object',
      },
    });
    expect(() => validateConfig(config2)).toThrow(CliStructuredError);
  });

  it('validates extensions array when present', () => {
    const config = createValidConfig({
      extensions: [
        {
          kind: 'extension',
          id: 'pg-vector',
          familyId: 'sql',
          targetId: 'postgres',
          manifest: {
            id: 'pg-vector',
            version: '1.0.0',
          },
          create: () => ({ familyId: 'sql', targetId: 'postgres' }),
        },
      ],
    });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('throws error when extensions is not an array', () => {
    const config = createValidConfig({
      extensions: 'not-an-array',
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when extension item is not an object', () => {
    const config = createValidConfig({
      extensions: ['not-an-object'],
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when extension.kind is not "extension"', () => {
    const config = createValidConfig({
      extensions: [
        {
          kind: 'invalid',
          id: 'pg-vector',
          family: 'sql',
          manifest: {},
        },
      ],
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when extension.id is not a string', () => {
    const config = createValidConfig({
      extensions: [
        {
          kind: 'extension',
          id: 123,
          family: 'sql',
          manifest: {},
        },
      ],
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when extension.family is not a string', () => {
    const config = createValidConfig({
      extensions: [
        {
          kind: 'extension',
          id: 'pg-vector',
          family: 123,
          manifest: {},
        },
      ],
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when extension.manifest is missing or not an object', () => {
    const config1 = createValidConfig({
      extensions: [
        {
          kind: 'extension',
          id: 'pg-vector',
          family: 'sql',
        },
      ],
    });
    expect(() => validateConfig(config1)).toThrow(CliStructuredError);

    const config2 = createValidConfig({
      extensions: [
        {
          kind: 'extension',
          id: 'pg-vector',
          family: 'sql',
          manifest: 'not-an-object',
        },
      ],
    });
    expect(() => validateConfig(config2)).toThrow(CliStructuredError);
  });

  it('validates contract config when present', () => {
    const config = createValidConfig({
      contract: {
        source: 'src/prisma/contract.ts',
        output: 'src/prisma/contract.json',
        types: 'src/prisma/contract.d.ts',
      },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('throws error when contract is not an object', () => {
    const config = createValidConfig({
      contract: 'not-an-object',
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when contract.source is missing', () => {
    const config = createValidConfig({
      contract: {
        output: 'src/prisma/contract.json',
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when contract.output is not a string', () => {
    const config = createValidConfig({
      contract: {
        source: 'src/prisma/contract.ts',
        output: 123,
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when contract.types is not a string', () => {
    const config = createValidConfig({
      contract: {
        source: 'src/prisma/contract.ts',
        types: 123,
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('allows contract.output to be undefined', () => {
    const config = createValidConfig({
      contract: {
        source: 'src/prisma/contract.ts',
      },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('allows contract.types to be undefined', () => {
    const config = createValidConfig({
      contract: {
        source: 'src/prisma/contract.ts',
      },
    });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('throws error when family.manifest is missing or not an object', () => {
    const config1 = createValidConfig({
      family: {
        kind: 'family',
        familyId: 'sql',
        hook: {},
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config1)).toThrow(CliStructuredError);

    const config2 = createValidConfig({
      family: {
        kind: 'family',
        familyId: 'sql',
        manifest: 'not-an-object',
        hook: {},
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config2)).toThrow(CliStructuredError);
  });

  it('throws error when family.create is not a function', () => {
    const config = createValidConfig({
      family: {
        kind: 'family',
        familyId: 'sql',
        manifest: { id: 'sql', version: '0.0.1' },
        hook: {},
        create: 'not-a-function',
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when target.familyId does not match family.familyId', () => {
    const config = createValidConfig({
      target: {
        kind: 'target',
        familyId: 'wrong-family',
        targetId: 'postgres',
        id: 'postgres',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when target.targetId is not a string', () => {
    const config = createValidConfig({
      target: {
        kind: 'target',
        familyId: 'sql',
        targetId: 123,
        id: 'postgres',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when target.create is not a function', () => {
    const config = createValidConfig({
      target: {
        kind: 'target',
        familyId: 'sql',
        targetId: 'postgres',
        id: 'postgres',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: 'not-a-function',
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when adapter.familyId does not match family.familyId', () => {
    const config = createValidConfig({
      adapter: {
        kind: 'adapter',
        familyId: 'wrong-family',
        targetId: 'postgres',
        id: 'postgres',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when adapter.targetId is not a string', () => {
    const config = createValidConfig({
      adapter: {
        kind: 'adapter',
        familyId: 'sql',
        targetId: 123,
        id: 'postgres',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when adapter.targetId does not match target.targetId', () => {
    const config = createValidConfig({
      adapter: {
        kind: 'adapter',
        familyId: 'sql',
        targetId: 'wrong-target',
        id: 'postgres',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when adapter.create is not a function', () => {
    const config = createValidConfig({
      adapter: {
        kind: 'adapter',
        familyId: 'sql',
        targetId: 'postgres',
        id: 'postgres',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: 'not-a-function',
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when extension.familyId does not match family.familyId', () => {
    const config = createValidConfig({
      extensions: [
        {
          kind: 'extension',
          id: 'pg-vector',
          familyId: 'wrong-family',
          targetId: 'postgres',
          manifest: { id: 'pg-vector', version: '1.0.0' },
          create: vi.fn(),
        },
      ],
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when extension.targetId is not a string', () => {
    const config = createValidConfig({
      extensions: [
        {
          kind: 'extension',
          id: 'pg-vector',
          familyId: 'sql',
          targetId: 123,
          manifest: { id: 'pg-vector', version: '1.0.0' },
          create: vi.fn(),
        },
      ],
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when extension.targetId does not match target.targetId', () => {
    const config = createValidConfig({
      extensions: [
        {
          kind: 'extension',
          id: 'pg-vector',
          familyId: 'sql',
          targetId: 'wrong-target',
          manifest: { id: 'pg-vector', version: '1.0.0' },
          create: vi.fn(),
        },
      ],
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when extension.create is not a function', () => {
    const config = createValidConfig({
      extensions: [
        {
          kind: 'extension',
          id: 'pg-vector',
          familyId: 'sql',
          targetId: 'postgres',
          manifest: { id: 'pg-vector', version: '1.0.0' },
          create: 'not-a-function',
        },
      ],
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('validates driver descriptor when present', () => {
    const config = createValidConfig();
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('throws error when driver.kind is not "driver"', () => {
    const config = createValidConfig({
      driver: {
        kind: 'invalid',
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when driver.id is not a string', () => {
    const config = createValidConfig({
      driver: {
        kind: 'driver',
        id: 123,
        familyId: 'sql',
        targetId: 'postgres',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when driver.manifest is missing or not an object', () => {
    const config1 = createValidConfig({
      driver: {
        kind: 'driver',
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config1)).toThrow(CliStructuredError);

    const config2 = createValidConfig({
      driver: {
        kind: 'driver',
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        manifest: 'not-an-object',
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config2)).toThrow(CliStructuredError);
  });

  it('throws error when driver.familyId is not a string', () => {
    const config = createValidConfig({
      driver: {
        kind: 'driver',
        id: 'postgres',
        familyId: 123,
        targetId: 'postgres',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when driver.familyId does not match family.familyId', () => {
    const config = createValidConfig({
      driver: {
        kind: 'driver',
        id: 'postgres',
        familyId: 'wrong-family',
        targetId: 'postgres',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when driver.targetId is not a string', () => {
    const config = createValidConfig({
      driver: {
        kind: 'driver',
        id: 'postgres',
        familyId: 'sql',
        targetId: 123,
        manifest: { id: 'postgres', version: '15.0.0' },
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when driver.targetId does not match target.targetId', () => {
    const config = createValidConfig({
      driver: {
        kind: 'driver',
        id: 'postgres',
        familyId: 'sql',
        targetId: 'wrong-target',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });

  it('throws error when driver.create is not a function', () => {
    const config = createValidConfig({
      driver: {
        kind: 'driver',
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        manifest: { id: 'postgres', version: '15.0.0' },
        create: 'not-a-function',
      },
    });
    expect(() => validateConfig(config)).toThrow(CliStructuredError);
  });
});
