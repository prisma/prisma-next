import type { SqlContract, SqlMappings, StorageColumn } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import {
  int4Column as int4ColumnType,
  vectorColumn as vectorColumnType,
} from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { attachOperationsToColumnBuilder } from '../src/operations-registry';
import { param } from '../src/param';
import { ColumnBuilderImpl, schema } from '../src/schema';
import type { ColumnBuilder } from '../src/types';
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
    }).toThrow('Argument 0 must be an ExpressionSource (ColumnBuilder or ExpressionBuilder)');
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
    // Operations now return ExpressionBuilder with kind: 'expression'
    expect(result).toHaveProperty('kind', 'expression');
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
    // Operations now return ExpressionBuilder with kind: 'expression'
    expect(result).toHaveProperty('kind', 'expression');
    expect(typeof result.multiply).toBe('function');
  });

  it('filters capability-gated operations on chained ExpressionBuilder when capabilities missing', () => {
    // First operation returns typeId, second operation requires capability
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
      method: 'specialOp',
      args: [{ kind: 'literal' }],
      capabilities: ['postgres.lateral'],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'special(${self}, ${arg0})',
      },
    };

    // Contract without capabilities - chained operations with capability requirements should not be attached
    const contractWithoutCaps = validateContract<TestContractWithIdOnly>({
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
    const context = createTestContext(contractWithoutCaps, adapter, {
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

    // First operation should be attached (no capability requirements)
    const result = idColumn.add(5) as unknown as {
      add?: (arg: unknown) => unknown;
      specialOp?: (arg: unknown) => unknown;
    };
    expect(result).toBeDefined();
    expect(result).toHaveProperty('kind', 'expression');
    // specialOp should NOT be attached since contract lacks capabilities
    expect(result.specialOp).toBeUndefined();
    // add should be attached since it has no capability requirements
    expect(typeof result.add).toBe('function');
  });

  it('filters capability-gated operations on chained ExpressionBuilder when capabilities do not match', () => {
    // First operation returns typeId, second operation requires capability
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
      method: 'specialOp',
      args: [{ kind: 'literal' }],
      capabilities: ['postgres.lateral'],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'special(${self}, ${arg0})',
      },
    };

    // Contract with capabilities that don't match
    const contractWithFalseCaps = validateContract<TestContractWithIdOnly>({
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
          operations: () => [firstSignature, secondSignature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id as unknown as {
      add: (arg: unknown) => unknown;
    };

    // First operation should be attached (no capability requirements)
    const result = idColumn.add(5) as unknown as {
      add?: (arg: unknown) => unknown;
      specialOp?: (arg: unknown) => unknown;
    };
    expect(result).toBeDefined();
    expect(result).toHaveProperty('kind', 'expression');
    // specialOp should NOT be attached since contract capabilities don't match
    expect(result.specialOp).toBeUndefined();
    // add should be attached since it has no capability requirements
    expect(typeof result.add).toBe('function');
  });

  it('handles ExpressionBuilder with existing operation expression', () => {
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
    // Operations now return ExpressionBuilder with kind: 'expression'
    expect(secondResult).toHaveProperty('kind', 'expression');
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

  it('handles operations with gt, lt, gte, lte methods on result', () => {
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
      gt: (value: ReturnType<typeof param>) => unknown;
      lt: (value: ReturnType<typeof param>) => unknown;
      gte: (value: ReturnType<typeof param>) => unknown;
      lte: (value: ReturnType<typeof param>) => unknown;
    };

    const binaryGt = result.gt(param('value'));
    expect(binaryGt).toHaveProperty('kind', 'binary');
    expect(binaryGt).toHaveProperty('op', 'gt');

    const binaryLt = result.lt(param('value'));
    expect(binaryLt).toHaveProperty('kind', 'binary');
    expect(binaryLt).toHaveProperty('op', 'lt');

    const binaryGte = result.gte(param('value'));
    expect(binaryGte).toHaveProperty('kind', 'binary');
    expect(binaryGte).toHaveProperty('op', 'gte');

    const binaryLte = result.lte(param('value'));
    expect(binaryLte).toHaveProperty('kind', 'binary');
    expect(binaryLte).toHaveProperty('op', 'lte');
  });

  it('handles operations that return builtin type (not typeId)', () => {
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
    // Operations now return ExpressionBuilder with kind: 'expression'
    expect(result).toHaveProperty('kind', 'expression');
    expect(result).toHaveProperty('columnMeta');
    // When return type is 'builtin', columnMeta should use original columnMeta (not modified)
    const resultWithMeta = result as unknown as { columnMeta: { codecId: string } };
    expect(resultWithMeta.columnMeta.codecId).toBe('pg/int4@1');
  });

  it('attachOperationsToColumnBuilder returns columnBuilder when registry is undefined', () => {
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
    const context = createTestContext(contractWithInt, adapter);
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id;

    const result = attachOperationsToColumnBuilder(
      idColumn as unknown as ColumnBuilder<string, StorageColumn, unknown, Record<string, never>>,
      idColumn.columnMeta,
      undefined, // registry is undefined
      undefined,
    );

    expect(result).toBe(idColumn);
  });

  it('attachOperationsToColumnBuilder returns columnBuilder when codecId is undefined', () => {
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
          operations: () => [
            {
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
            },
          ],
        },
      ],
    });

    // Create a fresh column builder without pre-attached operations
    const columnMeta = contractWithInt.storage.tables.user.columns.id;
    const freshColumnBuilder = new ColumnBuilderImpl('user', 'id', columnMeta);

    // Create columnMeta without codecId - use type assertion since StorageColumn requires codecId
    const columnMetaWithoutCodecId = {
      ...columnMeta,
      codecId: undefined,
    } as unknown as StorageColumn;

    const result = attachOperationsToColumnBuilder(
      freshColumnBuilder as unknown as ColumnBuilder<
        string,
        StorageColumn,
        unknown,
        Record<string, never>
      >,
      columnMetaWithoutCodecId,
      context.operations,
      undefined,
    );

    expect(result).toBe(freshColumnBuilder);
    // Operations should not be attached since codecId is undefined
    expect((result as unknown as { add?: unknown }).add).toBeUndefined();
  });

  it('attachOperationsToColumnBuilder returns columnBuilder when operations.length === 0', () => {
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
    // Create context with empty operation registry (no operations registered)
    const context = createTestContext(contractWithInt, adapter);
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id;

    const result = attachOperationsToColumnBuilder(
      idColumn as unknown as ColumnBuilder<string, StorageColumn, unknown, Record<string, never>>,
      idColumn.columnMeta,
      context.operations, // Registry exists but has no operations for this codecId
      undefined,
    );

    expect(result).toBe(idColumn);
    // Operations should not be attached since registry has no operations for this codecId
    expect((result as unknown as { add?: unknown }).add).toBeUndefined();
  });
});
