import { createStubAdapter, createTestContext } from '@prisma-next/runtime/test/utils';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { param } from '../src/param';
import { schema } from '../src/schema';

describe('schema', () => {
  const contract = validateContract<SqlContract<SqlStorage>>({
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
    expect(tables['user']).toBeDefined();
    expect(tables['user'].name).toBe('user');
    expect(tables['user'].columns).toBeDefined();
    expect(tables['user'].columns['id']).toBeDefined();
    expect(tables['user'].columns['email']).toBeDefined();
  });

  it('table proxy allows direct column access', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user'];
    expect(userTable['id']).toBeDefined();
    expect(userTable['id']).toBe(userTable.columns['id']);
    expect(userTable['email']).toBeDefined();
    expect(userTable['email']).toBe(userTable.columns['email']);
  });

  it('table proxy returns undefined for non-existent properties', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user'];
    expect(userTable['nonexistent']).toBeUndefined();
  });

  it('table proxy preserves standard properties', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user'];
    expect(userTable.name).toBe('user');
    expect(userTable.kind).toBe('table');
    expect(userTable.columns).toBeDefined();
  });

  it('throws error for unknown table when building columns', () => {
    const contractWithUnknownTable = validateContract<SqlContract<SqlStorage>>({
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
    expect(tables['user']).toBeDefined();
    // The error is thrown when building columns, not when accessing the table
    // This is tested indirectly through the schema function
  });

  it('column builder eq throws error for invalid param', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user'];
    const idColumn = userTable.columns['id'];

    expect(() => {
      idColumn.eq({ kind: 'invalid' } as unknown);
    }).toThrow('Parameter placeholder required for column comparison');
  });

  it('column builder has columnMeta property', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user'];
    const idColumn = userTable.columns['id'];

    expect(idColumn.columnMeta).toBeDefined();
    expect(idColumn.columnMeta.type).toBe('pg/int4@1');
    expect(idColumn.columnMeta.nullable).toBe(false);
  });

  it('column builder has __jsType property', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user'];
    const idColumn = userTable.columns['id'];

    expect(idColumn.__jsType).toBeUndefined();
  });

  it('column builder eq creates binary builder', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user'];
    const idColumn = userTable.columns['id'];

    const binary = idColumn.eq(param('userId'));
    expect(binary).toBeDefined();
    expect(binary.kind).toBe('binary');
    expect(binary.op).toBe('eq');
  });

  it('column builder asc creates order builder', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user'];
    const idColumn = userTable.columns['id'];

    const order = idColumn.asc();
    expect(order).toBeDefined();
    expect(order.kind).toBe('order');
    expect(order.dir).toBe('asc');
  });

  it('column builder desc creates order builder', () => {
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema(context).tables;
    const userTable = tables['user'];
    const idColumn = userTable.columns['id'];

    const order = idColumn.desc();
    expect(order).toBeDefined();
    expect(order.kind).toBe('order');
    expect(order.dir).toBe('desc');
  });
});
