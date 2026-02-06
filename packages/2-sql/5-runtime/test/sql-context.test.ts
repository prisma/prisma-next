import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  createExecutionContext,
  type SqlExecutionStack,
  type SqlRuntimeAdapterDescriptor,
  type SqlRuntimeExtensionDescriptor,
  type SqlRuntimeExtensionInstance,
  type SqlRuntimeTargetDescriptor,
} from '../src/sql-context';

const testContract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  coreHash: 'sha256:test' as never,
  models: {},
  relations: {},
  storage: { tables: {} },
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
};

function createStubCodecs(): CodecRegistry {
  const registry = createCodecRegistry();
  registry.register(
    codec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
  );
  return registry;
}

function createTestAdapterDescriptor(): SqlRuntimeAdapterDescriptor<'postgres'> {
  const codecRegistry = createStubCodecs();
  return {
    kind: 'adapter' as const,
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => codecRegistry,
    operationSignatures: () => [],
    parameterizedCodecs: () => [],
    create() {
      return {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        profile: {
          id: 'test-profile',
          target: 'postgres',
          capabilities: {},
          codecs: () => codecRegistry,
        },
        lower() {
          return {
            profileId: 'test-profile',
            body: Object.freeze({ sql: '', params: [] }),
          };
        },
      };
    },
  };
}

function createTestTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
    kind: 'target' as const,
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => createCodecRegistry(),
    operationSignatures: () => [],
    parameterizedCodecs: () => [],
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

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

  const operationsArray: ReadonlyArray<SqlOperationSignature> = hasOperations
    ? [
        {
          forTypeId: 'test/ext@1',
          method: 'testOp',
          args: [],
          returns: { kind: 'builtin' as const, type: 'number' as const },
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
    operationSignatures: () => operationsArray,
    parameterizedCodecs: () => [],
    create(): SqlRuntimeExtensionInstance<'postgres'> {
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
    adapter: createTestAdapterDescriptor(),
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
    expect(context.operations).toBeDefined();
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

    const ops = context.operations.byType('test/ext@1');
    expect(ops.length).toBe(1);
    expect(ops[0]?.method).toBe('testOp');
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

    const targetOps: SqlOperationSignature[] = [
      {
        forTypeId: 'target/special@1',
        method: 'targetOp',
        args: [],
        returns: { kind: 'builtin' as const, type: 'string' as const },
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
      operationSignatures: () => targetOps,
      parameterizedCodecs: () => [],
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    };

    const stack: SqlExecutionStack<'postgres'> = {
      target,
      adapter: createTestAdapterDescriptor(),
      extensionPacks: [createTestExtensionDescriptor({ hasCodecs: true, hasOperations: true })],
    };

    const context = createExecutionContext({ contract: testContract, stack });

    expect(context.codecs.has('target/special@1')).toBe(true);
    expect(context.codecs.has('pg/int4@1')).toBe(true);
    expect(context.codecs.has('test/ext@1')).toBe(true);

    expect(context.operations.byType('target/special@1').length).toBe(1);
    expect(context.operations.byType('target/special@1')[0]?.method).toBe('targetOp');
    expect(context.operations.byType('test/ext@1').length).toBe(1);
    expect(context.operations.byType('test/ext@1')[0]?.method).toBe('testOp');
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
  it('throws RUNTIME.CONTRACT_TARGET_MISMATCH when contract target differs from stack', () => {
    const mismatchedContract: SqlContract<SqlStorage> = {
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
    const contractWithExtension: SqlContract<SqlStorage> = {
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
    const contractWithExtensions: SqlContract<SqlStorage> = {
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
