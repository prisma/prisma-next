import { expectTypeOf, test } from 'vitest';
import { defineConfig, type PrismaNextConfig } from '../src/config-types';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlFamilyInstance,
  ControlTargetDescriptor,
} from '../src/types';

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
  create: (_stack) =>
    ({
      familyId: 'sql',
    }) as unknown as ControlFamilyInstance<'sql'>,
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
  create: async () =>
    ({
      familyId: 'sql',
      targetId: 'postgres',
      query: async () => ({ rows: [] }),
      close: async () => {},
    }) as ControlDriverInstance<'sql', 'postgres'>,
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

test('accepts compatible control descriptors', () => {
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

test('rejects mismatched target in target descriptor', () => {
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
    // @ts-expect-error targetId mismatch
    target: mysqlTargetDescriptor,
    adapter: postgresAdapterDescriptor,
  };

  void config;
});

test('rejects mismatched target in adapter descriptor', () => {
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
    // @ts-expect-error targetId mismatch
    adapter: mysqlAdapterDescriptor,
  };

  void config;
});
