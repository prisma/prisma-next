import { errorConfigValidation } from '../src/errors';
import { validateConfig } from '../src/config-validation';
import { describe, expect, it, vi } from 'vitest';

// Helper to create a minimal valid config for testing
function createValidConfig(overrides?: Record<string, unknown>) {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      hook: {},
      convertOperationManifest: vi.fn(),
      validateContractIR: vi.fn(),
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

describe('validateConfig', () => {
  it('validates valid config', () => {
    const config = createValidConfig();
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('throws error when config is not an object', () => {
    expect(() => validateConfig(null)).toThrow(errorConfigValidation('object'));
    expect(() => validateConfig(undefined)).toThrow(errorConfigValidation('object'));
    expect(() => validateConfig('string')).toThrow(errorConfigValidation('object'));
    expect(() => validateConfig(123)).toThrow(errorConfigValidation('object'));
  });

  it('throws error when family is missing', () => {
    const config = { target: {}, adapter: {} };
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('family'));
  });

  it('throws error when target is missing', () => {
    const config = { family: {}, adapter: {} };
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('target'));
  });

  it('throws error when adapter is missing', () => {
    const config = { family: {}, target: {} };
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('adapter'));
  });

  it('throws error when family.kind is not "family"', () => {
    const config = createValidConfig({
      family: {
        kind: 'invalid',
        id: 'sql',
        hook: {},
        convertOperationManifest: vi.fn(),
        validateContractIR: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('family.kind'));
  });

  it('throws error when family.id is not a string', () => {
    const config = createValidConfig({
      family: {
        kind: 'family',
        id: 123,
        hook: {},
        convertOperationManifest: vi.fn(),
        validateContractIR: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('family.id'));
  });

  it('throws error when family.hook is missing or not an object', () => {
    const config1 = createValidConfig({
      family: {
        kind: 'family',
        id: 'sql',
        convertOperationManifest: vi.fn(),
        validateContractIR: vi.fn(),
      },
    });
    expect(() => validateConfig(config1)).toThrow(errorConfigValidation('family.hook'));

    const config2 = createValidConfig({
      family: {
        kind: 'family',
        id: 'sql',
        hook: 'not-an-object',
        convertOperationManifest: vi.fn(),
        validateContractIR: vi.fn(),
      },
    });
    expect(() => validateConfig(config2)).toThrow(errorConfigValidation('family.hook'));
  });

  it('throws error when family.convertOperationManifest is not a function', () => {
    const config = createValidConfig({
      family: {
        kind: 'family',
        id: 'sql',
        hook: {},
        convertOperationManifest: 'not-a-function',
        validateContractIR: vi.fn(),
      },
    });
    expect(() => validateConfig(config)).toThrow(
      errorConfigValidation('family.convertOperationManifest'),
    );
  });

  it('throws error when family.validateContractIR is not a function', () => {
    const config = createValidConfig({
      family: {
        kind: 'family',
        id: 'sql',
        hook: {},
        convertOperationManifest: vi.fn(),
        validateContractIR: 'not-a-function',
      },
    });
    expect(() => validateConfig(config)).toThrow(
      errorConfigValidation('family.validateContractIR'),
    );
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
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('target.kind'));
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
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('target.id'));
  });

  it('throws error when target.family is not a string', () => {
    const config = createValidConfig({
      target: {
        kind: 'target',
        id: 'postgres',
        family: 123,
        manifest: {},
      },
    });
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('target.family'));
  });

  it('throws error when target.manifest is missing or not an object', () => {
    const config1 = createValidConfig({
      target: {
        kind: 'target',
        id: 'postgres',
        family: 'sql',
      },
    });
    expect(() => validateConfig(config1)).toThrow(errorConfigValidation('target.manifest'));

    const config2 = createValidConfig({
      target: {
        kind: 'target',
        id: 'postgres',
        family: 'sql',
        manifest: 'not-an-object',
      },
    });
    expect(() => validateConfig(config2)).toThrow(errorConfigValidation('target.manifest'));
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
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('adapter.kind'));
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
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('adapter.id'));
  });

  it('throws error when adapter.family is not a string', () => {
    const config = createValidConfig({
      adapter: {
        kind: 'adapter',
        id: 'postgres',
        family: 123,
        manifest: {},
      },
    });
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('adapter.family'));
  });

  it('throws error when adapter.manifest is missing or not an object', () => {
    const config1 = createValidConfig({
      adapter: {
        kind: 'adapter',
        id: 'postgres',
        family: 'sql',
      },
    });
    expect(() => validateConfig(config1)).toThrow(errorConfigValidation('adapter.manifest'));

    const config2 = createValidConfig({
      adapter: {
        kind: 'adapter',
        id: 'postgres',
        family: 'sql',
        manifest: 'not-an-object',
      },
    });
    expect(() => validateConfig(config2)).toThrow(errorConfigValidation('adapter.manifest'));
  });

  it('validates extensions array when present', () => {
    const config = createValidConfig({
      extensions: [
        {
          kind: 'extension',
          id: 'pg-vector',
          family: 'sql',
          manifest: {
            id: 'pg-vector',
            version: '1.0.0',
          },
        },
      ],
    });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('throws error when extensions is not an array', () => {
    const config = createValidConfig({
      extensions: 'not-an-array',
    });
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('extensions'));
  });

  it('throws error when extension item is not an object', () => {
    const config = createValidConfig({
      extensions: ['not-an-object'],
    });
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('extensions[]'));
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
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('extensions[].kind'));
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
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('extensions[].id'));
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
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('extensions[].family'));
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
    expect(() => validateConfig(config1)).toThrow(errorConfigValidation('extensions[].manifest'));

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
    expect(() => validateConfig(config2)).toThrow(errorConfigValidation('extensions[].manifest'));
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
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('contract'));
  });

  it('throws error when contract.source is missing', () => {
    const config = createValidConfig({
      contract: {
        output: 'src/prisma/contract.json',
      },
    });
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('contract.source'));
  });

  it('throws error when contract.output is not a string', () => {
    const config = createValidConfig({
      contract: {
        source: 'src/prisma/contract.ts',
        output: 123,
      },
    });
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('contract.output'));
  });

  it('throws error when contract.types is not a string', () => {
    const config = createValidConfig({
      contract: {
        source: 'src/prisma/contract.ts',
        types: 123,
      },
    });
    expect(() => validateConfig(config)).toThrow(errorConfigValidation('contract.types'));
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
});

