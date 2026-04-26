import { createExecutionStack } from '@prisma-next/framework-components/execution';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createExecutionContext, createSqlExecutionStack } from '../src/exports';
import type {
  ExecutionContext,
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeExtensionDescriptor,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createTestContract } from './utils';

function createStubAdapterDescriptor(): SqlRuntimeAdapterDescriptor<'postgres'> {
  const registry = createCodecRegistry();
  registry.register(
    codec({
      typeId: 'pg/text@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    }),
  );

  return {
    kind: 'adapter',
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => registry,
    parameterizedCodecs: () => [],
    create() {
      return Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        {
          profile: {
            id: 'test-profile',
            target: 'postgres',
            capabilities: {},
            codecs: () => registry,
            readMarkerStatement: () => ({ sql: '', params: [] }),
          },
          lower() {
            return Object.freeze({ sql: '', params: [] });
          },
        },
      );
    },
  };
}

function createStubTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => createCodecRegistry(),
    parameterizedCodecs: () => [],
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createStubExtensionDescriptor(): SqlRuntimeExtensionDescriptor<'postgres'> {
  const registry = createCodecRegistry();
  registry.register(
    codec({
      typeId: 'pg/uuid@1',
      targetTypes: ['uuid'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    }),
  );

  const operations = [
    {
      method: 'example',
      args: [] as const,
      returns: { codecId: 'pg/text@1', nullable: false },
      lowering: {
        targetFamily: 'sql' as const,
        strategy: 'function' as const,
        template: 'example({args})',
      },
    },
  ];

  return {
    kind: 'extension',
    id: 'test-extension',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => registry,
    queryOperations: () => operations,
    parameterizedCodecs: () => [],
    create() {
      return {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
      };
    },
  };
}

describe('createExecutionStack', () => {
  it('defaults driver to undefined and extensions to empty', () => {
    const stack = createExecutionStack({
      target: createStubTargetDescriptor(),
      adapter: createStubAdapterDescriptor(),
    });

    expect(stack.driver).toBeUndefined();
    expect(stack.extensionPacks).toEqual([]);
  });

  it('creates an execution context from descriptors-only stack', () => {
    const contract = createTestContract({
      storage: { tables: {} },
    });

    const context = createExecutionContext({
      contract,
      stack: {
        target: createStubTargetDescriptor(),
        adapter: createStubAdapterDescriptor(),
        extensionPacks: [createStubExtensionDescriptor()],
      },
    }) as ExecutionContext<typeof contract>;

    expect(context.contract).toBe(contract);
    expect(context.codecs.get('pg/text@1')).toBeDefined();
    expect(context.codecs.get('pg/uuid@1')).toBeDefined();
    expect(context.queryOperations.entries()['example']).toBeDefined();
    expect(context.types).toEqual({});
  });
});

describe('createSqlExecutionStack', () => {
  it('preserves descriptor references and defaults extensions', () => {
    const target = createStubTargetDescriptor();
    const adapter = createStubAdapterDescriptor();
    const stack = createSqlExecutionStack({ target, adapter });

    expect(stack.target).toBe(target);
    expect(stack.adapter).toBe(adapter);
    expect(stack.extensionPacks).toEqual([]);
  });

  it('keeps extension packs intact', () => {
    const target = createStubTargetDescriptor();
    const adapter = createStubAdapterDescriptor();
    const extension = createStubExtensionDescriptor();
    const stack = createSqlExecutionStack({ target, adapter, extensionPacks: [extension] });

    expect(stack.extensionPacks).toEqual([extension]);
  });
});
