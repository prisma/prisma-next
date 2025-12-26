import type { ExtractCodecTypes, SqlContract, SqlMappings } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import {
  int4Column as int4ColumnType,
  textColumn as textColumnType,
} from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { BinaryOp } from '../src/ast/types';
import { param } from '../src/param';
import type { SchemaHandle } from '../src/schema';
import { schema } from '../src/schema';
import type { OperationTypes } from '../src/types';
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
          readonly email: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
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

type TestSchemaHandle = SchemaHandle<TestContract, ExtractCodecTypes<TestContract>, OperationTypes>;
type TestUserTable = TestSchemaHandle['tables']['user'];

type MutableStorage = {
  tables: {
    user: {
      columns: Record<string, unknown>;
    };
  };
};

describe('schema', () => {
  const contract = validateContract<TestContract>({
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'test-hash',
    storage: {
      tables: {
        user: {
          columns: {
            id: { ...int4ColumnType, nullable: false },
            email: { ...textColumnType, nullable: false },
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

  it('creates schema with tables', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    expect(tables).toBeDefined();
    const userTable = tables.user;
    expect(userTable.name).toBe('user');
    expect(userTable.columns).toBeDefined();
    expect(userTable.columns.id).toBeDefined();
    expect(userTable.columns.email).toBeDefined();
  });

  it('table proxy allows direct column access', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable: TestUserTable = tables.user;
    // Test proxy access pattern: userTable.id should work via proxy
    // The proxy allows accessing columns directly on the table object
    const idViaProxy = (userTable as unknown as { id: typeof userTable.columns.id }).id;
    const emailViaProxy = (userTable as unknown as { email: typeof userTable.columns.email }).email;

    expect({
      idColumn: userTable.columns.id,
      emailColumn: userTable.columns.email,
      idViaProxy,
      emailViaProxy,
      idMatches: idViaProxy === userTable.columns.id,
      emailMatches: emailViaProxy === userTable.columns.email,
    }).toMatchObject({
      idColumn: userTable.columns.id,
      emailColumn: userTable.columns.email,
      idViaProxy: userTable.columns.id,
      emailViaProxy: userTable.columns.email,
      idMatches: true,
      emailMatches: true,
    });
  });

  it('table proxy returns undefined for non-existent properties', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable: TestUserTable = tables.user;
    const nonexistentColumn = (userTable.columns as Record<string, unknown>)['nonexistent'];
    const nonexistentViaProxy = (userTable as unknown as Record<string, unknown>)['nonexistent'];

    expect({
      columnAccess: nonexistentColumn,
      proxyAccess: nonexistentViaProxy,
    }).toMatchObject({
      columnAccess: undefined,
      proxyAccess: undefined,
    });
  });

  it('table proxy returns undefined for non-string properties', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable: TestUserTable = tables.user;
    // Access with Symbol or number to test non-string branch
    const symbolAccess = (userTable as unknown as Record<symbol, unknown>)[Symbol('test')];
    const numberAccess = (userTable as unknown as Record<number, unknown>)[0];

    expect({
      symbolAccess,
      numberAccess,
    }).toMatchObject({
      symbolAccess: undefined,
      numberAccess: undefined,
    });
  });

  it('table proxy preserves standard properties', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables.user;
    expect(userTable.name).toBe('user');
    expect(userTable.kind).toBe('table');
    expect(userTable.columns).toBeDefined();
  });

  it('handles undefined column definitions gracefully', () => {
    const contractWithUndefinedColumn = validateContract<TestContract>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
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
    const context = createTestContext(contractWithUndefinedColumn, adapter);
    // Manually manipulate storage to have undefined column to test continue branch
    // This tests the branch where columnDef is undefined (line 202 in schema.ts)
    const storage = context.contract.storage as unknown as MutableStorage;
    const userTable = storage.tables.user;
    // Add a key with undefined value to test the continue branch
    userTable.columns['undefinedColumn'] = undefined;

    const tables = schema(context).tables;
    const resultTable: TestUserTable = tables.user;
    const undefinedColumn = (resultTable.columns as Record<string, unknown>)['undefinedColumn'];

    expect({
      tableDefined: resultTable !== undefined,
      idDefined: resultTable.columns.id !== undefined,
      emailDefined: resultTable.columns.email !== undefined,
      undefinedColumnSkipped: undefinedColumn === undefined,
    }).toMatchObject({
      tableDefined: true,
      idDefined: true,
      emailDefined: true,
      undefinedColumnSkipped: true,
    });
  });

  it('column builder has columnMeta property', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable: TestUserTable = tables.user;
    const idColumn = userTable.columns.id;

    expect({
      hasColumnMeta: idColumn.columnMeta !== undefined,
      codecId: idColumn.columnMeta.codecId,
      nullable: idColumn.columnMeta.nullable,
    }).toMatchObject({
      hasColumnMeta: true,
      codecId: 'pg/int4@1',
      nullable: false,
    });
  });

  it('column builder has __jsType property', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id;

    expect(idColumn.__jsType).toBeUndefined();
  });

  describe('comparison operators', () => {
    const operators: BinaryOp[] = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte'];

    it.each(operators)('%s creates binary builder with correct op', (op) => {
      const adapter = createStubAdapter();
      const context = createTestContext(contract, adapter);
      const tables = schema(context).tables;
      const idColumn = tables.user.columns.id;

      const method = idColumn[op];
      const binary = method.call(idColumn, param('value'));

      expect(binary).toMatchObject({
        kind: 'binary',
        op,
      });
    });

    it.each(operators)('%s throws for invalid param', (op) => {
      const adapter = createStubAdapter();
      const context = createTestContext(contract, adapter);
      const tables = schema(context).tables;
      const idColumn = tables.user.columns.id;

      const method = idColumn[op] as (p: unknown) => unknown;
      expect(() => method.call(idColumn, { kind: 'invalid' })).toThrow(
        'Parameter placeholder required for column comparison',
      );
    });
  });

  it('column builder asc creates order builder', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable: TestUserTable = tables.user;
    const idColumn = userTable.columns.id;

    const order = idColumn.asc();
    expect({
      defined: order !== undefined,
      kind: order.kind,
      dir: order.dir,
    }).toMatchObject({
      defined: true,
      kind: 'order',
      dir: 'asc',
    });
  });

  it('column builder desc creates order builder', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable: TestUserTable = tables.user;
    const idColumn = userTable.columns.id;

    const order = idColumn.desc();
    expect({
      defined: order !== undefined,
      kind: order.kind,
      dir: order.dir,
    }).toMatchObject({
      defined: true,
      kind: 'order',
      dir: 'desc',
    });
  });
});
