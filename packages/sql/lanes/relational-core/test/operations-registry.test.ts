import { createStubAdapter, createTestContext } from '@prisma-next/runtime/test/utils';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlContract, SqlMappings } from '@prisma-next/sql-contract-types';
import type { OperationSignature } from '@prisma-next/sql-operations';
import { describe, expect, it } from 'vitest';
import { param } from '../src/param';
import { schema } from '../src/schema';

type TestContract = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; readonly nullable: false };
          readonly vector: { readonly type: 'pgvector/vector@1'; readonly nullable: false };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
    };
  },
  Record<string, never>,
  Record<string, never>,
  SqlMappings
>;

type TestContractWithIdOnly = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; readonly nullable: false };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
    };
  },
  Record<string, never>,
  Record<string, never>,
  SqlMappings
>;

describe('operations-registry', () => {
  const contract = validateContract<TestContract>({
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'test-hash',
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            vector: { type: 'pgvector/vector@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {},
  });

  it('attaches operations when registry is provided', () => {
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables.user;
    const vectorColumn = userTable.columns.vector;
    expect(typeof (vectorColumn as unknown as { cosineDistance: unknown }).cosineDistance).toBe(
      'function',
    );
  });

  it('does not attach operations when registry is not provided', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables.user;
    const vectorColumn = userTable.columns.vector;
    expect(
      (vectorColumn as unknown as { cosineDistance?: unknown }).cosineDistance,
    ).toBeUndefined();
  });

  it('filters operations by capabilities when capabilities are required', () => {
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      capabilities: ['postgres.lateral'],
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const contractWithoutCaps = validateContract<TestContract>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              vector: { type: 'pgvector/vector@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
    });

    const contractWithCaps = validateContract<TestContract>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              vector: { type: 'pgvector/vector@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
      capabilities: {
        postgres: {
          lateral: true,
        },
      },
    });

    const adapter = createStubAdapter();
    const contextWithoutCapabilities = createTestContext(contractWithoutCaps, adapter, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tablesWithoutCaps = schema(contextWithoutCapabilities).tables;
    const userTableWithoutCaps = tablesWithoutCaps.user;
    const vectorColumnWithoutCaps = userTableWithoutCaps.columns.vector;
    expect(
      (vectorColumnWithoutCaps as unknown as { cosineDistance?: unknown }).cosineDistance,
    ).toBeUndefined();

    const contextWithCapabilities = createTestContext(contractWithCaps, adapter, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tablesWithCaps = schema(contextWithCapabilities).tables;
    const userTableWithCaps = tablesWithCaps.user;
    const vectorColumnWithCaps = userTableWithCaps.columns.vector;
    expect(
      typeof (vectorColumnWithCaps as unknown as { cosineDistance: unknown }).cosineDistance,
    ).toBe('function');
  });

  it('filters operations when capabilities are missing', () => {
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      capabilities: ['postgres.lateral'],
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const contractWithFalseCaps = validateContract<TestContract>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              vector: { type: 'pgvector/vector@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
      capabilities: {
        postgres: {
          lateral: false,
        },
      },
    });

    const adapter = createStubAdapter();
    const context = createTestContext(contractWithFalseCaps, adapter, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables.user;
    const vectorColumn = userTable.columns.vector;
    expect(
      (vectorColumn as unknown as { cosineDistance?: unknown }).cosineDistance,
    ).toBeUndefined();
  });

  it('handles operations with multiple capability requirements', () => {
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      capabilities: ['postgres.lateral', 'postgres.jsonAgg'],
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const contractWithPartialCaps = validateContract<TestContract>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              vector: { type: 'pgvector/vector@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
      capabilities: {
        postgres: {
          lateral: true,
          jsonAgg: false,
        },
      },
    });

    const contractWithAllCaps = validateContract<TestContract>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              vector: { type: 'pgvector/vector@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
      capabilities: {
        postgres: {
          lateral: true,
          jsonAgg: true,
        },
      },
    });

    const adapter = createStubAdapter();
    const contextWithPartialCaps = createTestContext(contractWithPartialCaps, adapter, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tablesPartial = schema(contextWithPartialCaps).tables;
    const userTablePartial = tablesPartial.user;
    const vectorColumnPartial = userTablePartial.columns.vector;
    expect(
      (vectorColumnPartial as unknown as { cosineDistance?: unknown }).cosineDistance,
    ).toBeUndefined();

    const contextWithAllCaps = createTestContext(contractWithAllCaps, adapter, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tablesAll = schema(contextWithAllCaps).tables;
    const userTableAll = tablesAll.user;
    const vectorColumnAll = userTableAll.columns.vector;
    expect(typeof (vectorColumnAll as unknown as { cosineDistance: unknown }).cosineDistance).toBe(
      'function',
    );
  });

  it('handles operations with no capabilities requirement', () => {
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables.user;
    const vectorColumn = userTable.columns.vector;
    expect(typeof (vectorColumn as unknown as { cosineDistance: unknown }).cosineDistance).toBe(
      'function',
    );
  });

  it('handles operations when contractCapabilities is undefined', () => {
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      capabilities: ['postgres.lateral'],
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const contractWithoutCaps = validateContract<TestContract>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              vector: { type: 'pgvector/vector@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
    });

    const adapter = createStubAdapter();
    const context = createTestContext(contractWithoutCaps, adapter, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables.user;
    const vectorColumn = userTable.columns.vector;
    expect(
      (vectorColumn as unknown as { cosineDistance?: unknown }).cosineDistance,
    ).toBeUndefined();
  });

  it('throws error for wrong number of arguments', () => {
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables.user;
    const vectorColumn = userTable.columns.vector as unknown as {
      cosineDistance: (...args: unknown[]) => unknown;
    };

    expect(() => {
      vectorColumn.cosineDistance();
    }).toThrow('Operation cosineDistance expects 1 arguments, got 0');

    expect(() => {
      vectorColumn.cosineDistance(param('arg1'), param('arg2'));
    }).toThrow('Operation cosineDistance expects 1 arguments, got 2');
  });

  it('throws error for invalid param argument', () => {
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables.user;
    const vectorColumn = userTable.columns.vector as unknown as {
      cosineDistance: (arg: unknown) => unknown;
    };

    expect(() => {
      vectorColumn.cosineDistance('not a param' as unknown);
    }).toThrow('Argument 0 must be a parameter placeholder');
  });

  it('throws error for invalid column builder argument', () => {
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables.user;
    const vectorColumn = userTable.columns.vector as unknown as {
      cosineDistance: (arg: unknown) => unknown;
    };

    expect(() => {
      vectorColumn.cosineDistance('not a column builder' as unknown);
    }).toThrow('Argument 0 must be a ColumnBuilder');
  });

  it('handles literal arguments', () => {
    const signature: OperationSignature = {
      forTypeId: 'pg/int4@1',
      method: 'add',
      args: [{ kind: 'literal' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} + ${arg0}',
      },
    };

    const contractWithInt = validateContract<TestContractWithIdOnly>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
    });

    const adapter = createStubAdapter();
    const context = createTestContext(contractWithInt, adapter, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id as unknown as {
      add: (arg: unknown) => unknown;
    };

    const result = idColumn.add(5);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('kind', 'column');
  });
});
