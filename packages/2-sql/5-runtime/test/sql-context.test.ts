import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { CodecRegistry, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  type SqlRuntimeExtensionDescriptor,
  type SqlRuntimeExtensionInstance,
} from '../src/sql-context.ts';

// Minimal test contract
const testContract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  coreHash: 'sha256:test',
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

// Stub adapter codecs
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

// Create a test adapter descriptor
function createTestAdapterDescriptor() {
  const codecs = createStubCodecs();
  return {
    kind: 'adapter' as const,
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create() {
      return {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        profile: {
          id: 'test-profile',
          target: 'postgres',
          capabilities: {},
          codecs() {
            return codecs;
          },
        },
        lower(ast: SelectAst) {
          return {
            profileId: 'test-profile',
            body: Object.freeze({ sql: JSON.stringify(ast), params: [] }),
          };
        },
      };
    },
  };
}

// Create a test target descriptor
function createTestTargetDescriptor() {
  return {
    kind: 'target' as const,
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

// Create a test extension descriptor
function createTestExtensionDescriptor(options?: {
  hasCodecs?: boolean;
  hasOperations?: boolean;
}): SqlRuntimeExtensionDescriptor<'postgres'> {
  const { hasCodecs = false, hasOperations = false } = options ?? {};

  // Build the codecs function if needed
  const codecsFn = hasCodecs
    ? () => {
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
      }
    : undefined;

  // Build the operations function if needed
  const operationsFn = hasOperations
    ? (): ReadonlyArray<SqlOperationSignature> => [
        {
          forTypeId: 'test/ext@1',
          method: 'testOp',
          args: [],
          returns: { kind: 'builtin', type: 'number' },
          lowering: { targetFamily: 'sql', strategy: 'function', template: 'test()' },
        },
      ]
    : undefined;

  return {
    kind: 'extension' as const,
    id: 'test-extension',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create(): SqlRuntimeExtensionInstance<'postgres'> {
      // Return object with optional methods only if they exist
      const instance: SqlRuntimeExtensionInstance<'postgres'> = {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
      };
      if (codecsFn) {
        (instance as { codecs?: () => CodecRegistry }).codecs = codecsFn;
      }
      if (operationsFn) {
        (instance as { operations?: () => ReadonlyArray<SqlOperationSignature> }).operations =
          operationsFn;
      }
      return instance;
    },
  };
}

describe('createRuntimeContext', () => {
  it('creates context with adapter codecs', () => {
    const context = createRuntimeContext({
      contract: testContract,
      target: createTestTargetDescriptor(),
      adapter: createTestAdapterDescriptor(),
    });

    expect(context.contract).toBe(testContract);
    expect(context.adapter).toBeDefined();
    expect(context.codecs.has('pg/int4@1')).toBe(true);
    expect(context.operations).toBeDefined();
  });

  it('creates context with empty extension packs', () => {
    const context = createRuntimeContext({
      contract: testContract,
      target: createTestTargetDescriptor(),
      adapter: createTestAdapterDescriptor(),
      extensionPacks: [],
    });

    expect(context.codecs.has('pg/int4@1')).toBe(true);
    // No extension codecs registered
    expect(context.codecs.has('test/ext@1')).toBe(false);
  });

  it('registers extension codecs', () => {
    const context = createRuntimeContext({
      contract: testContract,
      target: createTestTargetDescriptor(),
      adapter: createTestAdapterDescriptor(),
      extensionPacks: [createTestExtensionDescriptor({ hasCodecs: true })],
    });

    // Adapter codec
    expect(context.codecs.has('pg/int4@1')).toBe(true);
    // Extension codec
    expect(context.codecs.has('test/ext@1')).toBe(true);
  });

  it('registers extension operations', () => {
    const context = createRuntimeContext({
      contract: testContract,
      target: createTestTargetDescriptor(),
      adapter: createTestAdapterDescriptor(),
      extensionPacks: [createTestExtensionDescriptor({ hasOperations: true })],
    });

    const ops = context.operations.byType('test/ext@1');
    expect(ops.length).toBe(1);
    expect(ops[0]?.method).toBe('testOp');
  });

  it('handles extension without codecs or operations', () => {
    const context = createRuntimeContext({
      contract: testContract,
      target: createTestTargetDescriptor(),
      adapter: createTestAdapterDescriptor(),
      extensionPacks: [createTestExtensionDescriptor({ hasCodecs: false, hasOperations: false })],
    });

    // Only adapter codec
    expect(context.codecs.has('pg/int4@1')).toBe(true);
    expect(context.codecs.has('test/ext@1')).toBe(false);
  });
});
