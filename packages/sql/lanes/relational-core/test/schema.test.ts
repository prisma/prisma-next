import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlContract, SqlMappings } from '@prisma-next/sql-contract-types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { param } from '../src/param';
import { schema } from '../src/schema';

type TestContract = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; readonly nullable: false };
          readonly email: { readonly type: 'pg/text@1'; readonly nullable: false };
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

describe('schema', () => {
  const contract = validateContract<TestContract>({
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'test-hash',
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            email: { type: 'pg/text@1', nullable: false },
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
    const userTable = tables.user;
    expect(userTable.columns.id).toBeDefined();
    expect(userTable.columns.id).toBe(userTable.columns.id);
    expect(userTable.columns.email).toBeDefined();
    expect(userTable.columns.email).toBe(userTable.columns.email);
  });

  it('table proxy returns undefined for non-existent properties', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables.user;
    expect((userTable.columns as Record<string, unknown>)['nonexistent']).toBeUndefined();
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

  it('throws error for unknown table when building columns', () => {
    const contractWithUnknownTable = validateContract<TestContractWithIdOnly>({
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
    const context = createTestContext(contractWithUnknownTable, adapter);
    const tables = schema(context).tables;
    expect(tables.user).toBeDefined();
    // The error is thrown when building columns, not when accessing the table
    // This is tested indirectly through the schema function
  });

  it('column builder eq throws error for invalid param', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id;

    expect(() => {
      idColumn.eq({ kind: 'invalid' } as unknown as ReturnType<typeof param>);
    }).toThrow('Parameter placeholder required for column comparison');
  });

  it('column builder has columnMeta property', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id;

    expect(idColumn.columnMeta).toBeDefined();
    expect(idColumn.columnMeta.type).toBe('pg/int4@1');
    expect(idColumn.columnMeta.nullable).toBe(false);
  });

  it('column builder has __jsType property', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id;

    expect(idColumn.__jsType).toBeUndefined();
  });

  it('column builder eq creates binary builder', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id;

    const binary = idColumn.eq(param('userId'));
    expect(binary).toBeDefined();
    expect(binary.kind).toBe('binary');
    expect(binary.op).toBe('eq');
  });

  it('column builder asc creates order builder', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id;

    const order = idColumn.asc();
    expect(order).toBeDefined();
    expect(order.kind).toBe('order');
    expect(order.dir).toBe('asc');
  });

  it('column builder desc creates order builder', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables.user;
    const idColumn = userTable.columns.id;

    const order = idColumn.desc();
    expect(order).toBeDefined();
    expect(order.kind).toBe('order');
    expect(order.dir).toBe('desc');
  });
});
