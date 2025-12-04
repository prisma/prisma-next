import type { SqlContract, SqlMappings } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import { describe, expect, it } from 'vitest';
import { vectorColumn as vectorColumnType } from '../../../../extensions/pgvector/src/exports/column-types';
import { int4Column as int4ColumnType } from '../../../../targets/postgres-adapter/src/exports/column-types';
import { param } from '../src/param';
import { schema } from '../src/schema';
import { createStubAdapter, createTestContext } from './utils';

type TestContract = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly vector: {
            readonly nativeType: 'vector';
            readonly codecId: 'pg/vector@1';
            readonly nullable: false;
          };
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
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
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
            id: { ...int4ColumnType, nullable: false },
            vector: { ...vectorColumnType, nullable: false },
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
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
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
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
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
              id: { ...int4ColumnType, nullable: false },
              vector: { ...vectorColumnType, nullable: false },
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
              id: { ...int4ColumnType, nullable: false },
              vector: { ...vectorColumnType, nullable: false },
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
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
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
              id: { ...int4ColumnType, nullable: false },
              vector: { ...vectorColumnType, nullable: false },
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
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
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
              id: { ...int4ColumnType, nullable: false },
              vector: { ...vectorColumnType, nullable: false },
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
              id: { ...int4ColumnType, nullable: false },
              vector: { ...vectorColumnType, nullable: false },
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
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
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
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
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
              id: { ...int4ColumnType, nullable: false },
              vector: { ...vectorColumnType, nullable: false },
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
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
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
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
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
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
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
    const signature: SqlOperationSignature = {
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
              id: { ...int4ColumnType, nullable: false },
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

  it('handles operations with returnTypeId that attach operations recursively', () => {
    const firstSignature: SqlOperationSignature = {
      forTypeId: 'pg/int4@1',
      method: 'add',
      args: [{ kind: 'literal' }],
      returns: { kind: 'typeId', type: 'pg/int4@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} + ${arg0}',
      },
    };

    const secondSignature: SqlOperationSignature = {
      forTypeId: 'pg/int4@1',
      method: 'multiply',
      args: [{ kind: 'literal' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} * ${arg0}',
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
              id: { ...int4ColumnType, nullable: false },
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
          operations: () => [firstSignature, secondSignature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id as unknown as {
      add: (arg: unknown) => unknown;
    };

    const result = idColumn.add(5) as unknown as {
      multiply: (arg: unknown) => unknown;
    };
    expect(result).toBeDefined();
    expect(result).toHaveProperty('kind', 'column');
    expect(typeof result.multiply).toBe('function');
  });

  it('handles column builder with existing operation expression', () => {
    const firstSignature: SqlOperationSignature = {
      forTypeId: 'pg/int4@1',
      method: 'add',
      args: [{ kind: 'typeId', type: 'pg/int4@1' }],
      returns: { kind: 'typeId', type: 'pg/int4@1' },
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
              id: { ...int4ColumnType, nullable: false },
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
          operations: () => [firstSignature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id as unknown as {
      add: (arg: unknown) => unknown;
    };

    const firstResult = idColumn.add(idColumn);
    const secondResult = idColumn.add(firstResult);
    expect(secondResult).toBeDefined();
    expect(secondResult).toHaveProperty('kind', 'column');
  });

  it('handles operations with eq, asc, and desc methods on result', () => {
    const signature: SqlOperationSignature = {
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
              id: { ...int4ColumnType, nullable: false },
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

    const result = idColumn.add(5) as unknown as {
      eq: (value: ReturnType<typeof param>) => unknown;
      asc: () => unknown;
      desc: () => unknown;
    };

    const binary = result.eq(param('value'));
    expect(binary).toHaveProperty('kind', 'binary');
    expect(binary).toHaveProperty('op', 'eq');

    const orderAsc = result.asc();
    expect(orderAsc).toHaveProperty('kind', 'order');
    expect(orderAsc).toHaveProperty('dir', 'asc');

    const orderDesc = result.desc();
    expect(orderDesc).toHaveProperty('kind', 'order');
    expect(orderDesc).toHaveProperty('dir', 'desc');
  });
});
