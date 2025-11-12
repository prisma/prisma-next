import { describe, expect, it } from 'vitest';
import type { PrismaNextConfig } from '../src/config-types';
import { defineConfig } from '../src/config-types';

describe('defineConfig', () => {
  it('returns the config object unchanged', () => {
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };

    const config: PrismaNextConfig = {
      family: {
        kind: 'family',
        id: 'sql',
        hook: mockHook,
        convertOperationManifest: () => ({
          forTypeId: '',
          method: '',
          args: [],
          returns: { kind: 'builtin', type: 'string' },
        }),
        validateContractIR: (contract: unknown) => contract,
      },
      target: {
        kind: 'target',
        id: 'postgres',
        family: 'sql',
        manifest: { id: 'postgres', version: '1.0.0' },
      },
      adapter: {
        kind: 'adapter',
        id: 'postgres',
        family: 'sql',
        manifest: { id: 'postgres', version: '1.0.0' },
      },
      extensions: [],
    };

    const result = defineConfig(config);
    expect(result).toBe(config);
    expect(result.family.id).toBe('sql');
    expect(result.target.id).toBe('postgres');
    expect(result.adapter.id).toBe('postgres');
  });
});
