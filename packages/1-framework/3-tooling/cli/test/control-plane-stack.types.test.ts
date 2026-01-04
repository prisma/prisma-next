import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlPlaneStack,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/types';
import { expectTypeOf, test } from 'vitest';

/**
 * Mock descriptors for type-level tests.
 * Uses the same pattern as config-types.test.ts.
 */
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
  version: '0.0.1',
  hook: mockHook,
  create: () => ({
    familyId: 'sql',
    validateContractIR: (contract: unknown) => contract as ContractIR,
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
      schema: {
        issues: [],
        root: {
          status: 'pass' as const,
          kind: 'root',
          name: 'root',
          contractPath: '',
          code: '',
          message: '',
          expected: null,
          actual: null,
          children: [],
        },
        counts: { pass: 0, warn: 0, fail: 0, totalNodes: 0 },
      },
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
    readMarker: async () => null,
    introspect: async () => ({ tables: {}, extensionPacks: [] }),
    emitContract: async () => ({
      contractJson: '{}',
      contractDts: '',
      coreHash: 'test',
      profileHash: 'test',
    }),
  }),
};

const postgresTarget: ControlTargetDescriptor<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  create: () => ({ familyId: 'sql', targetId: 'postgres' }),
};

const postgresAdapter: ControlAdapterDescriptor<'sql', 'postgres'> = {
  kind: 'adapter',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  create: () => ({ familyId: 'sql', targetId: 'postgres' }),
};

const postgresDriver: ControlDriverDescriptor<'sql', 'postgres'> = {
  kind: 'driver',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  create: async () => ({
    familyId: 'sql',
    targetId: 'postgres',
    query: async () => ({ rows: [] }),
    close: async () => {},
  }),
};

const postgresExtension: ControlExtensionDescriptor<'sql', 'postgres'> = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  create: () => ({ familyId: 'sql', targetId: 'postgres' }),
};

test('creates stack and passes it to family.create()', () => {
  const stack = createControlPlaneStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [postgresExtension],
  });

  sqlFamilyDescriptor.create(stack);

  expectTypeOf(sqlFamilyDescriptor).toExtend<ControlFamilyDescriptor<'sql'>>();
  expectTypeOf(stack).toExtend<ControlPlaneStack<'sql', 'postgres'>>();
});

test('rejects mismatched targetId between target and adapter', () => {
  const mysqlTarget: ControlTargetDescriptor<'sql', 'mysql'> = {
    kind: 'target',
    id: 'mysql',
    familyId: 'sql',
    targetId: 'mysql',
    version: '0.0.1',
    create: () => ({ familyId: 'sql', targetId: 'mysql' }),
  };

  // This correctly fails at compile time - targetId mismatch: mysql vs postgres
  // The adapter property is incompatible because TTargetId doesn't match
  createControlPlaneStack({
    target: mysqlTarget,
    // @ts-expect-error - adapter targetId 'postgres' doesn't match target targetId 'mysql'
    adapter: postgresAdapter,
    driver: undefined,
    extensionPacks: undefined,
  });
});

test('rejects mismatched familyId between target and adapter', () => {
  const docTarget: ControlTargetDescriptor<'document', 'mongodb'> = {
    kind: 'target',
    id: 'mongodb',
    familyId: 'document',
    targetId: 'mongodb',
    version: '0.0.1',
    create: () => ({ familyId: 'document', targetId: 'mongodb' }),
  };

  // This correctly fails at compile time - familyId mismatch: document vs sql
  // The adapter property is incompatible because TFamilyId doesn't match
  createControlPlaneStack({
    target: docTarget,
    // @ts-expect-error - adapter familyId 'sql' doesn't match target familyId 'document'
    adapter: postgresAdapter,
    driver: undefined,
    extensionPacks: undefined,
  });
});
