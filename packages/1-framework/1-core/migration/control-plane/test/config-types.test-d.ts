// @ts-nocheck FIXME: this module is all broken without a clear path to fixing.

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
  id: 'sql',
  familyId: 'sql',
  manifest: { id: 'sql', version: '0.0.1' },
  hook: mockHook,
  create: (_stack) => ({
    familyId: 'sql',
  }),
};

const postgresTargetDescriptor: ControlTargetDescriptor<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  manifest: { id: 'postgres', version: '0.0.1' },
  create: () => ({
    familyId: 'sql',
    targetId: 'postgres',
  }),
};

const postgresAdapterDescriptor: ControlAdapterDescriptor<'sql', 'postgres'> = {
  kind: 'adapter',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  manifest: { id: 'postgres', version: '0.0.1' },
  create: () => ({
    familyId: 'sql',
    targetId: 'postgres',
  }),
};

const postgresDriverDescriptor: ControlDriverDescriptor<'sql', 'postgres'> = {
  kind: 'driver',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  manifest: { id: 'postgres', version: '0.0.1' },
  create: async () => ({
    targetId: 'postgres',
    query: async () => ({ rows: [] }),
    close: async () => {},
  }),
};

const postgresExtensionDescriptor: ControlExtensionDescriptor<'sql', 'postgres'> = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  manifest: { id: 'pgvector', version: '0.0.1' },
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
    id: 'mysql',
    familyId: 'sql',
    targetId: 'mysql',
    manifest: { id: 'mysql', version: '0.0.1' },
    create: () => ({
      familyId: 'sql',
      targetId: 'mysql',
    }),
  };

  // @ts-expect-error - targetId mismatch: 'mysql' vs 'postgres'
  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: mysqlTargetDescriptor, // Wrong targetId
    adapter: postgresAdapterDescriptor,
  };

  void config;
});

test('rejects mismatched targetId in adapter', () => {
  const mysqlAdapterDescriptor: ControlAdapterDescriptor<'sql', 'mysql'> = {
    kind: 'adapter',
    id: 'mysql',
    familyId: 'sql',
    targetId: 'mysql',
    manifest: { id: 'mysql', version: '0.0.1' },
    create: () => ({
      familyId: 'sql',
      targetId: 'mysql',
    }),
  };

  // @ts-expect-error - targetId mismatch: 'mysql' vs 'postgres'
  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: mysqlAdapterDescriptor, // Wrong targetId
  };

  void config;
});

test('rejects mismatched targetId in driver', () => {
  const mysqlDriverDescriptor: ControlDriverDescriptor<'sql', 'mysql'> = {
    kind: 'driver',
    id: 'mysql',
    familyId: 'sql',
    targetId: 'mysql',
    manifest: { id: 'mysql', version: '0.0.1' },
    create: async () => ({
      targetId: 'mysql',
      query: async () => ({ rows: [] }),
      close: async () => {},
    }),
  };

  // @ts-expect-error - targetId mismatch: 'mysql' vs 'postgres'
  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    driver: mysqlDriverDescriptor, // Wrong targetId
  };

  void config;
});

test('rejects mismatched targetId in extension', () => {
  const mysqlExtensionDescriptor: ControlExtensionDescriptor<'sql', 'mysql'> = {
    kind: 'extension',
    id: 'mysql-extension',
    familyId: 'sql',
    targetId: 'mysql',
    manifest: { id: 'mysql-extension', version: '0.0.1' },
    create: () => ({
      familyId: 'sql',
      targetId: 'mysql',
    }),
  };

  // @ts-expect-error - targetId mismatch: 'mysql' vs 'postgres'
  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    extensionPacks: [mysqlExtensionDescriptor], // Wrong targetId
  };

  void config;
});
