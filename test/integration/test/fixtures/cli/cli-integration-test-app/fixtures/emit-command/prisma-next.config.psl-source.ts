import { defineConfig } from '@prisma-next/cli/config-types';

const mockHook = {
  id: 'sql',
  validateTypes: () => {},
  validateStructure: () => {},
  generateContractTypes: () => '',
};

export default defineConfig({
  family: {
    kind: 'family',
    id: 'sql',
    familyId: 'sql',
    version: '0.0.1',
    hook: mockHook,
    create: () => ({
      familyId: 'sql',
      validateContractIR: (contract: unknown) => contract,
      verify: async () => ({
        ok: true,
        summary: 'ok',
        contract: { storageHash: 'test-storage-hash' },
        target: { expected: 'postgres' },
        timings: { total: 0 },
      }),
      schemaVerify: async () => ({
        ok: true,
        summary: 'ok',
        contract: { storageHash: 'test-storage-hash' },
        target: { expected: 'postgres' },
        schema: {
          issues: [],
          root: {
            status: 'pass' as const,
            kind: 'root',
            name: 'root',
            contractPath: '',
            code: 'OK',
            message: 'OK',
            expected: {},
            actual: {},
            children: [],
          },
          counts: { pass: 1, warn: 0, fail: 0, totalNodes: 1 },
        },
        timings: { total: 0 },
      }),
      sign: async () => ({
        ok: true,
        summary: 'ok',
        contract: { storageHash: 'test-storage-hash' },
        target: { expected: 'postgres' },
        marker: { created: true, updated: false },
        timings: { total: 0 },
      }),
      readMarker: async () => null,
      introspect: async () => ({ tables: {}, extensionPacks: [] }),
      emitContract: async ({ contractIR }: { readonly contractIR: unknown }) => ({
        storageHash: 'test-storage-hash',
        profileHash: 'test-profile-hash',
        contractJson: JSON.stringify({
          targetFamily: 'sql',
          _generated: { generatedAt: 'test' },
          source: contractIR,
        }),
        contractDts: 'export type Contract = unknown;',
      }),
    }),
  },
  target: {
    kind: 'target',
    id: 'postgres',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  },
  adapter: {
    kind: 'adapter',
    id: 'postgres',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  },
  extensionPacks: [],
  contract: {
    source: {
      kind: 'psl',
      schemaPath: './schema.prisma',
    },
    output: 'output/contract.json',
  },
});
