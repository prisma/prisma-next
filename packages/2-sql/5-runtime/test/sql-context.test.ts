import { type Contract, coreHash, executionHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlOperationDescriptor } from '@prisma-next/sql-operations';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  createExecutionContext,
  type SqlExecutionStack,
  type SqlRuntimeExtensionDescriptor,
  type SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import {
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestTargetDescriptor,
} from './utils';

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('sha256:test'),
  models: {},
  roots: {},
  storage: { storageHash: coreHash('sha256:test'), tables: {} },
  extensionPacks: {},
  capabilities: {},
  meta: {},
};

function createTestExtensionDescriptor(options?: {
  hasCodecs?: boolean;
  hasOperations?: boolean;
}): SqlRuntimeExtensionDescriptor<'postgres'> {
  const { hasCodecs = false, hasOperations = false } = options ?? {};

  const codecRegistry = hasCodecs
    ? (() => {
        const registry = createCodecRegistry();
        registry.register(
          codec({
            typeId: 'test/ext@1',
            targetTypes: ['ext'],
            encode: (v: string) => v,
            decode: (w: string) => w,
          }),
        );
        return registry;
      })()
    : createCodecRegistry();

  const operationsArray: ReadonlyArray<SqlOperationDescriptor> = hasOperations
    ? [
        {
          method: 'testOp',
          args: [{ codecId: 'test/ext@1', nullable: false }],
          returns: { codecId: 'test/ext@1', nullable: false },
          lowering: {
            targetFamily: 'sql' as const,
            strategy: 'function' as const,
            template: 'test()',
          },
        },
      ]
    : [];

  return {
    kind: 'extension' as const,
    id: 'test-extension',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => codecRegistry,
    queryOperations: () => operationsArray,
    parameterizedCodecs: () => [],
    create() {
      return {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
      };
    },
  };
}

function createStack(options?: {
  extensionPacks?: ReadonlyArray<SqlRuntimeExtensionDescriptor<'postgres'>>;
}): SqlExecutionStack<'postgres'> {
  return {
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(createStubAdapter()),
    extensionPacks: options?.extensionPacks ?? [],
  };
}

describe('createExecutionContext', () => {
  it('creates context with adapter codecs from descriptor', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: createStack(),
    });

    expect(context.contract).toBe(testContract);
    expect(context.codecs.has('pg/int4@1')).toBe(true);
    expect(context.queryOperations).toBeDefined();
  });

  it('creates context with empty extension packs', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: createStack({ extensionPacks: [] }),
    });

    expect(context.codecs.has('pg/int4@1')).toBe(true);
    expect(context.codecs.has('test/ext@1')).toBe(false);
  });

  it('registers extension codecs from descriptors', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: createStack({
        extensionPacks: [createTestExtensionDescriptor({ hasCodecs: true })],
      }),
    });

    expect(context.codecs.has('pg/int4@1')).toBe(true);
    expect(context.codecs.has('test/ext@1')).toBe(true);
  });

  it('registers extension operations from descriptors', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: createStack({
        extensionPacks: [createTestExtensionDescriptor({ hasOperations: true })],
      }),
    });

    const entries = context.queryOperations.entries();
    expect(entries['testOp']).toBeDefined();
  });

  it('handles extension with no contributions', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: createStack({
        extensionPacks: [createTestExtensionDescriptor({ hasCodecs: false, hasOperations: false })],
      }),
    });

    expect(context.codecs.has('pg/int4@1')).toBe(true);
    expect(context.codecs.has('test/ext@1')).toBe(false);
  });
});

describe('comprehensive descriptor-based derivation', () => {
  it('includes all expected codec IDs and operations from target, adapter, and extensions', () => {
    const targetCodecRegistry = createCodecRegistry();
    targetCodecRegistry.register(
      codec({
        typeId: 'target/special@1',
        targetTypes: ['special'],
        encode: (v: string) => v,
        decode: (w: string) => w,
      }),
    );

    const targetOps: SqlOperationDescriptor[] = [
      {
        method: 'targetOp',
        args: [{ codecId: 'target/special@1', nullable: false }],
        returns: { codecId: 'target/special@1', nullable: false },
        lowering: {
          targetFamily: 'sql' as const,
          strategy: 'function' as const,
          template: 'target_fn()',
        },
      },
    ];

    const target: SqlRuntimeTargetDescriptor<'postgres'> = {
      kind: 'target' as const,
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      codecs: () => targetCodecRegistry,
      queryOperations: () => targetOps,
      parameterizedCodecs: () => [],
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    };

    const stack: SqlExecutionStack<'postgres'> = {
      target,
      adapter: createTestAdapterDescriptor(createStubAdapter()),
      extensionPacks: [createTestExtensionDescriptor({ hasCodecs: true, hasOperations: true })],
    };

    const context = createExecutionContext({ contract: testContract, stack });

    expect(context.codecs.has('target/special@1')).toBe(true);
    expect(context.codecs.has('pg/int4@1')).toBe(true);
    expect(context.codecs.has('test/ext@1')).toBe(true);

    const entries = context.queryOperations.entries();
    expect(entries['targetOp']).toBeDefined();
    expect(entries['testOp']).toBeDefined();
  });
});

describe('context.types presence', () => {
  it('exists as empty object when no parameterized codecs are registered', () => {
    const context = createExecutionContext({
      contract: testContract,
      stack: createStack(),
    });

    expect(context.types).toBeDefined();
    expect(context.types).toEqual({});
  });
});

describe('contract/stack validation errors', () => {
  it('throws RUNTIME.CONTRACT_FAMILY_MISMATCH when contract targetFamily differs from stack', () => {
    const mismatchedFamilyContract = {
      ...testContract,
      targetFamily: 'document',
    } as unknown as Contract<SqlStorage>;

    expect(() =>
      createExecutionContext({ contract: mismatchedFamilyContract, stack: createStack() }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.CONTRACT_FAMILY_MISMATCH',
        category: 'RUNTIME',
        severity: 'error',
        details: {
          actual: 'document',
          expected: 'sql',
        },
      }),
    );
  });

  it('throws RUNTIME.CONTRACT_TARGET_MISMATCH when contract target differs from stack', () => {
    const mismatchedContract: Contract<SqlStorage> = {
      ...testContract,
      target: 'mysql',
    };

    expect(() =>
      createExecutionContext({ contract: mismatchedContract, stack: createStack() }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.CONTRACT_TARGET_MISMATCH',
        category: 'RUNTIME',
        severity: 'error',
        details: {
          actual: 'mysql',
          expected: 'postgres',
        },
      }),
    );
  });

  it('throws RUNTIME.MISSING_EXTENSION_PACK when contract requires extension not in stack', () => {
    const contractWithExtension: Contract<SqlStorage> = {
      ...testContract,
      extensionPacks: {
        'required-extension': { id: 'required-extension', version: '1.0.0', capabilities: {} },
      },
    };

    expect(() =>
      createExecutionContext({ contract: contractWithExtension, stack: createStack() }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MISSING_EXTENSION_PACK',
        category: 'RUNTIME',
        severity: 'error',
        details: {
          packIds: ['required-extension'],
        },
      }),
    );
  });

  it('lists all missing extension packs in a single error', () => {
    const contractWithExtensions: Contract<SqlStorage> = {
      ...testContract,
      extensionPacks: {
        'ext-a': { id: 'ext-a', version: '1.0.0', capabilities: {} },
        'ext-b': { id: 'ext-b', version: '1.0.0', capabilities: {} },
      },
    };

    expect(() =>
      createExecutionContext({ contract: contractWithExtensions, stack: createStack() }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MISSING_EXTENSION_PACK',
        details: {
          packIds: expect.arrayContaining(['ext-a', 'ext-b']),
        },
      }),
    );
  });
});

describe('applyMutationDefaults', () => {
  const contractWithDefaults: Contract<SqlStorage> = {
    ...testContract,
    storage: {
      storageHash: coreHash('sha256:test'),
      tables: {
        user: {
          columns: {
            id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            slug: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    execution: {
      executionHash: executionHash('sha256:test'),
      mutations: {
        defaults: [
          {
            ref: { table: 'user', column: 'id' },
            onCreate: { kind: 'generator', id: 'nanoid', params: { size: 8 } },
          },
          {
            ref: { table: 'user', column: 'slug' },
            onUpdate: { kind: 'generator', id: 'nanoid', params: { size: 6 } },
          },
        ],
      },
    },
  };

  it('applies create defaults with generator params', () => {
    const context = createExecutionContext({
      contract: contractWithDefaults,
      stack: createStack(),
    });

    const applied = context.applyMutationDefaults({
      op: 'create',
      table: 'user',
      values: {},
    });

    expect(applied).toEqual([
      {
        column: 'id',
        value: expect.any(String),
      },
    ]);
    expect((applied[0]?.value as string).length).toBe(8);
  });

  it('applies update defaults from onUpdate', () => {
    const context = createExecutionContext({
      contract: contractWithDefaults,
      stack: createStack(),
    });

    const applied = context.applyMutationDefaults({
      op: 'update',
      table: 'user',
      values: {},
    });

    expect(applied).toEqual([
      {
        column: 'slug',
        value: expect.any(String),
      },
    ]);
    expect((applied[0]?.value as string).length).toBe(6);
  });
});
