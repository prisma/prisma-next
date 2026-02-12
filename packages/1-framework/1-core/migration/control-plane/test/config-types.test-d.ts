import { expectTypeOf, test } from 'vitest';
import type { PrismaNextConfig } from '../src/config-types';
import { defineConfig } from '../src/config-types';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
} from '../src/types';

// Type-level tests for defineConfig compatibility enforcement

const mockHook = {
  id: 'sql',
  validateTypes: () => {},
  validateStructure: () => {},
  generateContractTypes: () => '',
};

const sqlFamilyDescriptor: ControlFamilyDescriptor<'sql'> = {
  kind: 'family',
  version: '1',
  id: 'sql',
  familyId: 'sql',
  hook: mockHook,
  create: (_stack) => ({
    familyId: 'sql',
    emitContract: async () => ({
      contractDts: '',
      contractJson: '{}',
      storageHash: '',
      profileHash: '',
    }),
    introspect: async () => ({}),
    readMarkers: async () => ({}),
    readMarker: async () => null,
    schemaVerify: async () => ({
      contract: {
        storageHash: '',
      },
      ok: true,
      schema: {
        counts: {
          models: 0,
          enums: 0,
          relations: 0,
          fields: 0,
          fail: 0,
          pass: 0,
          totalNodes: 0,
          warn: 0,
        },
        issues: [],
        root: {
          models: [],
          enums: [],
          actual: '',
          children: [],
          code: '',
          contractPath: '',
          expected: '',
          kind: '',
          message: '',
          name: '',
          status: 'pass',
        },
      },
      summary: '',
      target: { expected: 'mysql' },
      timings: { total: 0 },
    }),
    sign: async () => ({
      contract: {
        storageHash: '',
      },
      marker: {
        created: true,
        updated: true,
      },
      ok: true,
      summary: '',
      target: { expected: '' },
      timings: { total: 0 },
    }),
    validateContractIR: () => ({
      capabilities: {},
      extensionPacks: {},
      meta: {},
      models: {},
      relations: {},
      schemaVersion: '1',
      sources: {},
      storage: {},
      target: '',
      targetFamily: '',
    }),
    verify: async () => ({
      contract: {
        storageHash: '',
      },
      ok: true,
      summary: '',
      target: { expected: '' },
      timings: { total: 0 },
    }),
  }),
};

const postgresTargetDescriptor: ControlTargetDescriptor<'sql', 'postgres'> = {
  kind: 'target',
  version: '1',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  create: () => ({
    familyId: 'sql',
    targetId: 'postgres',
  }),
};

const postgresAdapterDescriptor: ControlAdapterDescriptor<'sql', 'postgres'> = {
  kind: 'adapter',
  version: '1',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  create: () => ({
    familyId: 'sql',
    targetId: 'postgres',
  }),
};

const postgresDriverDescriptor: ControlDriverDescriptor<'sql', 'postgres'> = {
  kind: 'driver',
  version: '1',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  create: async () => ({
    targetId: 'postgres',
    query: async () => ({ rows: [] }),
    close: async () => {},
    familyId: 'sql',
  }),
};

const postgresExtensionDescriptor: ControlExtensionDescriptor<'sql', 'postgres'> = {
  kind: 'extension',
  version: '1',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  create: () => ({
    familyId: 'sql',
    targetId: 'postgres',
  }),
};

test('accepts compatible Control*Descriptor types', () => {
  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    driver: postgresDriverDescriptor,
    extensionPacks: [postgresExtensionDescriptor],
  };

  const result = defineConfig(config);
  expectTypeOf(result).toExtend<PrismaNextConfig<'sql', 'postgres'>>();
});

test('rejects mismatched targetId in target', () => {
  const mysqlTargetDescriptor: ControlTargetDescriptor<'sql', 'mysql'> = {
    kind: 'target',
    version: '1',
    id: 'mysql',
    familyId: 'sql',
    targetId: 'mysql',
    create: () => ({
      familyId: 'sql',
      targetId: 'mysql',
    }),
  };

  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    // @ts-expect-error - targetId mismatch: 'mysql' vs 'postgres'
    target: mysqlTargetDescriptor,
    adapter: postgresAdapterDescriptor,
  };

  void config;
});

test('rejects mismatched targetId in adapter', () => {
  const mysqlAdapterDescriptor: ControlAdapterDescriptor<'sql', 'mysql'> = {
    kind: 'adapter',
    version: '1',
    id: 'mysql',
    familyId: 'sql',
    targetId: 'mysql',
    create: () => ({
      familyId: 'sql',
      targetId: 'mysql',
    }),
  };

  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    // @ts-expect-error - targetId mismatch: 'mysql' vs 'postgres'
    adapter: mysqlAdapterDescriptor,
  };

  void config;
});

test('rejects mismatched targetId in driver', () => {
  const mysqlDriverDescriptor: ControlDriverDescriptor<'sql', 'mysql'> = {
    kind: 'driver',
    version: '1',
    id: 'mysql',
    familyId: 'sql',
    targetId: 'mysql',
    create: async () => ({
      targetId: 'mysql',
      query: async () => ({ rows: [] }),
      close: async () => {},
      familyId: 'sql',
    }),
  };

  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    // @ts-expect-error - targetId mismatch: 'mysql' vs 'postgres'
    driver: mysqlDriverDescriptor,
  };

  void config;
});

test('rejects mismatched targetId in extension', () => {
  const mysqlExtensionDescriptor: ControlExtensionDescriptor<'sql', 'mysql'> = {
    kind: 'extension',
    version: '1',
    id: 'mysql-extension',
    familyId: 'sql',
    targetId: 'mysql',
    create: () => ({
      familyId: 'sql',
      targetId: 'mysql',
    }),
  };

  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    // @ts-expect-error - targetId mismatch: 'mysql' vs 'postgres'
    extensionPacks: [mysqlExtensionDescriptor],
  };

  void config;
});
