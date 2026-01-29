import {
  createExecutionStack,
  instantiateExecutionStack,
} from '@prisma-next/core-execution-plane/stack';
import type {
  RuntimeAdapterDescriptor,
  RuntimeDriverDescriptor,
  RuntimeTargetDescriptor,
} from '@prisma-next/core-execution-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  Adapter,
  LoweredStatement,
  QueryAst,
  SqlDriver,
} from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createExecutionContext } from '../src/exports';
import type {
  ExecutionContext,
  SqlRuntimeAdapterInstance,
  SqlRuntimeDriverInstance,
  SqlRuntimeExtensionDescriptor,
  SqlRuntimeExtensionInstance,
} from '../src/sql-context';
import { createTestContract } from './utils';

function createStubAdapterDescriptor(): RuntimeAdapterDescriptor<
  'sql',
  'postgres',
  SqlRuntimeAdapterInstance<'postgres'>
> {
  return {
    kind: 'adapter',
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create(): SqlRuntimeAdapterInstance<'postgres'> {
      const registry = createCodecRegistry();
      registry.register(
        codec({
          typeId: 'pg/text@1',
          targetTypes: ['text'],
          encode: (value: string) => value,
          decode: (wire: string) => wire,
        }),
      );

      const adapter: Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement> = {
        profile: {
          id: 'test-profile',
          target: 'postgres',
          capabilities: {},
          codecs: () => registry,
        },
        lower(
          ast: QueryAst,
          ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] },
        ) {
          return {
            profileId: 'test-profile',
            body: Object.freeze({ sql: JSON.stringify(ast), params: ctx.params ?? [] }),
          };
        },
      };

      return Object.assign(
        {
          familyId: 'sql' as const,
          targetId: 'postgres' as const,
        },
        adapter,
      );
    },
  };
}

function createStubTargetDescriptor(): RuntimeTargetDescriptor<'sql', 'postgres'> {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create() {
      return {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
      };
    },
  };
}

function createStubDriverDescriptor(): RuntimeDriverDescriptor<
  'sql',
  'postgres',
  SqlRuntimeDriverInstance<'postgres'>
> {
  const driver: SqlDriver = {
    async connect() {},
    async *execute() {},
    async acquireConnection() {
      throw new Error('Method not implemented.');
    },
    async query() {
      return { rows: [] };
    },
    async close() {},
  };

  return {
    kind: 'driver',
    id: 'test-driver',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create() {
      return Object.assign(
        {
          familyId: 'sql' as const,
          targetId: 'postgres' as const,
        },
        driver,
      ) as SqlRuntimeDriverInstance<'postgres'>;
    },
  };
}

function createStubExtensionDescriptor(): SqlRuntimeExtensionDescriptor<'postgres'> {
  return {
    kind: 'extension',
    id: 'test-extension',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    create(): SqlRuntimeExtensionInstance<'postgres'> {
      const registry = createCodecRegistry();
      registry.register(
        codec({
          typeId: 'pg/uuid@1',
          targetTypes: ['uuid'],
          encode: (value: string) => value,
          decode: (wire: string) => wire,
        }),
      );

      return {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => registry,
        operations: () => [
          {
            forTypeId: 'pg/text@1',
            method: 'example',
            args: [],
            returns: { kind: 'builtin', type: 'string' },
            lowering: {
              targetFamily: 'sql',
              strategy: 'function',
              template: 'example({args})',
            },
          },
        ],
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

  it('creates an execution context with registries and types', () => {
    const stack = createExecutionStack({
      target: createStubTargetDescriptor(),
      adapter: createStubAdapterDescriptor(),
      driver: createStubDriverDescriptor(),
      extensionPacks: [createStubExtensionDescriptor()],
    });

    const contract = createTestContract({
      storage: { tables: {} },
    });

    const stackInstance = instantiateExecutionStack(stack);
    const context = createExecutionContext({
      contract,
      stackInstance,
    }) as ExecutionContext<typeof contract>;

    expect(context.contract).toBe(contract);
    expect(context.codecs.get('pg/text@1')).toBeDefined();
    expect(context.codecs.get('pg/uuid@1')).toBeDefined();
    expect(context.operations.byType('pg/text@1')).toHaveLength(1);
    expect(context.types).toEqual({});
  });
});
