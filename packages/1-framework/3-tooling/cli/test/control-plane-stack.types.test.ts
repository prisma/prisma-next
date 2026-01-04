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

test('stack has correct structure', () => {
  const stack = createControlPlaneStack({
    target: postgresTarget,
    adapter: postgresAdapter,
  });

  expectTypeOf(stack.target).toExtend<ControlTargetDescriptor<'sql', 'postgres'>>();
  expectTypeOf(stack.adapter).toExtend<ControlAdapterDescriptor<'sql', 'postgres'>>();
  expectTypeOf(stack.driver).toEqualTypeOf<
    ControlDriverDescriptor<'sql', 'postgres'> | undefined
  >();
  expectTypeOf(stack.extensionPacks).toExtend<
    readonly ControlExtensionDescriptor<'sql', 'postgres'>[]
  >();
});

test('stack with all optional properties omitted', () => {
  const stack = createControlPlaneStack({
    target: postgresTarget,
    adapter: postgresAdapter,
  });

  // driver and extensionPacks default correctly
  expectTypeOf(stack.driver).toEqualTypeOf<
    ControlDriverDescriptor<'sql', 'postgres'> | undefined
  >();
  expectTypeOf(stack.extensionPacks).toExtend<
    readonly ControlExtensionDescriptor<'sql', 'postgres'>[]
  >();
});

test('family.create() rejects mismatched familyId in stack', () => {
  const documentFamilyDescriptor: ControlFamilyDescriptor<'document'> = {
    kind: 'family',
    id: 'document',
    familyId: 'document',
    version: '0.0.1',
    hook: mockHook,
    create: () => ({
      familyId: 'document',
      validateContractIR: (contract: unknown) => contract as ContractIR,
      verify: async () => ({
        ok: true,
        summary: 'test',
        contract: { coreHash: 'test' },
        target: { expected: 'mongodb' },
        timings: { total: 0 },
      }),
      schemaVerify: async () => ({
        ok: true,
        summary: 'test',
        contract: { coreHash: 'test' },
        target: { expected: 'mongodb' },
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
        target: { expected: 'mongodb' },
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

  // Stack with sql familyId
  const sqlStack = createControlPlaneStack({
    target: postgresTarget,
    adapter: postgresAdapter,
  });

  // This correctly fails at compile time - familyId mismatch: document vs sql
  // @ts-expect-error - stack familyId 'sql' doesn't match family descriptor familyId 'document'
  documentFamilyDescriptor.create(sqlStack);
});
