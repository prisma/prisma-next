import { coreHash } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  createExecutionContext,
  type SqlExecutionStack,
  type SqlRuntimeExtensionDescriptor,
} from '../src/sql-context';
import {
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestTargetDescriptor,
} from './utils';

const testContract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  storageHash: coreHash('sha256:test'),
  models: {},
  relations: {},
  storage: {
    tables: {
      user: {
        columns: {
          id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
  mappings: {},
};

function createStack(
  extensionPacks: ReadonlyArray<SqlRuntimeExtensionDescriptor<'postgres'>>,
): SqlExecutionStack<'postgres'> {
  return {
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(createStubAdapter()),
    extensionPacks,
  };
}

describe('composed runtime mutation default generators', () => {
  it('resolves a pack-contributed generator id', () => {
    const extension: SqlRuntimeExtensionDescriptor<'postgres'> = {
      kind: 'extension',
      id: 'test-mutation-defaults',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      codecs: () => createCodecRegistry(),
      operationSignatures: () => [],
      parameterizedCodecs: () => [],
      mutationDefaultGenerators: () => [
        {
          id: 'slugid',
          generate: () => 'slug-from-pack',
        },
      ],
      create() {
        return { familyId: 'sql', targetId: 'postgres' };
      },
    };

    const context = createExecutionContext({
      contract: {
        ...testContract,
        execution: {
          mutations: {
            defaults: [
              {
                ref: { table: 'user', column: 'id' },
                onCreate: { kind: 'generator', id: 'slugid' },
              },
            ],
          },
        },
      },
      stack: createStack([extension]),
    });

    const applied = context.applyMutationDefaults({ op: 'create', table: 'user', values: {} });
    expect(applied).toEqual([{ column: 'id', value: 'slug-from-pack' }]);
  });

  it('includes both owners when duplicate generator ids are composed', () => {
    const first: SqlRuntimeExtensionDescriptor<'postgres'> = {
      kind: 'extension',
      id: 'first-pack',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      codecs: () => createCodecRegistry(),
      operationSignatures: () => [],
      parameterizedCodecs: () => [],
      mutationDefaultGenerators: () => [{ id: 'duplicate', generate: () => 'first' }],
      create() {
        return { familyId: 'sql', targetId: 'postgres' };
      },
    };
    const second: SqlRuntimeExtensionDescriptor<'postgres'> = {
      kind: 'extension',
      id: 'second-pack',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      codecs: () => createCodecRegistry(),
      operationSignatures: () => [],
      parameterizedCodecs: () => [],
      mutationDefaultGenerators: () => [{ id: 'duplicate', generate: () => 'second' }],
      create() {
        return { familyId: 'sql', targetId: 'postgres' };
      },
    };

    expect(() =>
      createExecutionContext({
        contract: testContract,
        stack: createStack([first, second]),
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR',
        details: expect.objectContaining({
          existingOwner: 'first-pack',
          incomingOwner: 'second-pack',
        }),
      }),
    );
  });

  it('throws stable error when generator id implementation is missing', () => {
    const context = createExecutionContext({
      contract: {
        ...testContract,
        execution: {
          mutations: {
            defaults: [
              {
                ref: { table: 'user', column: 'id' },
                onCreate: { kind: 'generator', id: 'unknown-generator' },
              },
            ],
          },
        },
      },
      stack: createStack([]),
    });

    expect(() =>
      context.applyMutationDefaults({
        op: 'create',
        table: 'user',
        values: {},
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
      }),
    );
  });

  it('does not resolve built-in generator ids without composed contributors', () => {
    const adapterWithoutMutationDefaultGenerators = {
      ...createTestAdapterDescriptor(createStubAdapter()),
      mutationDefaultGenerators: () => [],
    };
    const context = createExecutionContext({
      contract: {
        ...testContract,
        execution: {
          mutations: {
            defaults: [
              {
                ref: { table: 'user', column: 'id' },
                onCreate: { kind: 'generator', id: 'uuidv4' },
              },
            ],
          },
        },
      },
      stack: {
        target: createTestTargetDescriptor(),
        adapter: adapterWithoutMutationDefaultGenerators,
        extensionPacks: [],
      },
    });

    expect(() =>
      context.applyMutationDefaults({
        op: 'create',
        table: 'user',
        values: {},
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
      }),
    );
  });
});
