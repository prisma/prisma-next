import { describe, it, expect } from 'vitest';
import { makeT } from '../src/maket';
import { TABLE_NAME } from '../src/types';
import type { Column, Table, Expression } from '../src/types';

describe('makeT factory function', () => {
  // Define proper TypeScript interfaces for our test schema
  interface UserShape {
    id: number;
    email: string;
    active: boolean;
    createdAt: Date;
  }

  interface PostShape {
    id: number;
    title: string;
    userId: number;
  }

  interface TestTables {
    user: Table<UserShape>;
    post: Table<PostShape>;
  }

  const mockSchema = {
    models: [
      {
        name: 'User',
        fields: [
          {
            name: 'id',
            type: 'Int',
            attributes: [
              { name: 'id' },
              { name: 'default', value: { type: 'autoincrement' } }
            ]
          },
          {
            name: 'email',
            type: 'String',
            attributes: [
              { name: 'unique' }
            ]
          },
          {
            name: 'active',
            type: 'Boolean',
            attributes: [
              { name: 'default', value: { type: 'literal', value: 'true' } }
            ]
          },
          {
            name: 'createdAt',
            type: 'DateTime',
            attributes: [
              { name: 'default', value: { type: 'now' } }
            ]
          }
        ]
      },
      {
        name: 'Post',
        fields: [
          {
            name: 'id',
            type: 'Int',
            attributes: [{ name: 'id' }]
          },
          {
            name: 'title',
            type: 'String',
            attributes: []
          },
          {
            name: 'userId',
            type: 'Int',
            attributes: []
          }
        ]
      }
    ]
  };

  it('creates tables with correct structure', () => {
    const t = makeT<TestTables>(mockSchema);

    // Check that tables exist
    expect(t).toHaveProperty('user');
    expect(t).toHaveProperty('post');

    // Check table structure
    expect(t.user[TABLE_NAME]).toBe('user');
    expect(t.post[TABLE_NAME]).toBe('post');

    // Verify table names are correctly lowercased
    expect(t.user[TABLE_NAME]).toBe('user');
    expect(t.post[TABLE_NAME]).toBe('post');
  });

  it('creates columns with correct properties', () => {
    const t = makeT<TestTables>(mockSchema);

    // Check user columns have correct Column structure
    const userIdColumn: Column<number> = t.user.id;
    expect(userIdColumn.table).toBe('user');
    expect(userIdColumn.name).toBe('id');
    expect(userIdColumn.__t).toBeUndefined();

    const emailColumn: Column<string> = t.user.email;
    expect(emailColumn.table).toBe('user');
    expect(emailColumn.name).toBe('email');

    const activeColumn: Column<boolean> = t.user.active;
    expect(activeColumn.table).toBe('user');
    expect(activeColumn.name).toBe('active');

    const createdAtColumn: Column<Date> = t.user.createdAt;
    expect(createdAtColumn.table).toBe('user');
    expect(createdAtColumn.name).toBe('createdAt');

    // Check post columns
    expect(t.post.id.table).toBe('post');
    expect(t.post.id.name).toBe('id');
    expect(t.post.title.table).toBe('post');
    expect(t.post.title.name).toBe('title');
    expect(t.post.userId.table).toBe('post');
    expect(t.post.userId.name).toBe('userId');
  });

  it('creates columns with all required operators', () => {
    const t = makeT<TestTables>(mockSchema);

    const column: Column<number> = t.user.id;

    // Check that all operators exist and are functions
    expect(typeof column.eq).toBe('function');
    expect(typeof column.ne).toBe('function');
    expect(typeof column.gt).toBe('function');
    expect(typeof column.lt).toBe('function');
    expect(typeof column.gte).toBe('function');
    expect(typeof column.lte).toBe('function');
    expect(typeof column.in).toBe('function');

    // Verify operators return Expression<boolean> types
    const eqResult: Expression<boolean> = column.eq(123);
    const neResult: Expression<boolean> = column.ne(456);
    const gtResult: Expression<boolean> = column.gt(100);
    const ltResult: Expression<boolean> = column.lt(200);
    const gteResult: Expression<boolean> = column.gte(50);
    const lteResult: Expression<boolean> = column.lte(150);
    const inResult: Expression<boolean> = column.in([1, 2, 3]);

    // All should be truthy (not null/undefined)
    expect(eqResult).toBeTruthy();
    expect(neResult).toBeTruthy();
    expect(gtResult).toBeTruthy();
    expect(ltResult).toBeTruthy();
    expect(gteResult).toBeTruthy();
    expect(lteResult).toBeTruthy();
    expect(inResult).toBeTruthy();
  });

  it('operators return correct expression structure', () => {
    const t = makeT<TestTables>(mockSchema);

    // Test all operators with proper type checking
    const testValue = 123;
    const testArray = [1, 2, 3];

    // Test eq operator
    const eqExpr = t.user.id.eq(testValue);
    expect(eqExpr).toEqual({
      __t: undefined,
      type: 'eq',
      field: 'id',
      value: testValue
    });
    expect(eqExpr.type).toBe('eq');
    expect(eqExpr.field).toBe('id');
    expect(eqExpr.value).toBe(testValue);

    // Test ne operator
    const neExpr = t.user.email.ne('test@example.com');
    expect(neExpr.type).toBe('ne');
    expect(neExpr.field).toBe('email');
    expect(neExpr.value).toBe('test@example.com');

    // Test gt operator
    const gtExpr = t.user.id.gt(100);
    expect(gtExpr.type).toBe('gt');
    expect(gtExpr.field).toBe('id');
    expect(gtExpr.value).toBe(100);

    // Test lt operator
    const ltExpr = t.user.id.lt(200);
    expect(ltExpr.type).toBe('lt');
    expect(ltExpr.field).toBe('id');
    expect(ltExpr.value).toBe(200);

    // Test gte operator
    const gteExpr = t.user.id.gte(50);
    expect(gteExpr.type).toBe('gte');
    expect(gteExpr.field).toBe('id');
    expect(gteExpr.value).toBe(50);

    // Test lte operator
    const lteExpr = t.user.id.lte(150);
    expect(lteExpr.type).toBe('lte');
    expect(lteExpr.field).toBe('id');
    expect(lteExpr.value).toBe(150);

    // Test in operator
    const inExpr = t.user.id.in(testArray);
    expect(inExpr.type).toBe('in');
    expect(inExpr.field).toBe('id');
    expect(inExpr.values).toEqual(testArray);
    expect(Array.isArray(inExpr.values)).toBe(true);
  });

  it('handles different field types correctly', () => {
    const t = makeT<TestTables>(mockSchema);

    // Test Int field with proper type inference
    const intExpr = t.user.id.eq(123);
    expect(intExpr.value).toBe(123);
    expect(typeof intExpr.value).toBe('number');

    // Test String field with proper type inference
    const stringExpr = t.user.email.eq('test@example.com');
    expect(stringExpr.value).toBe('test@example.com');
    expect(typeof stringExpr.value).toBe('string');

    // Test Boolean field with proper type inference
    const boolExpr = t.user.active.eq(true);
    expect(boolExpr.value).toBe(true);
    expect(typeof boolExpr.value).toBe('boolean');

    // Test DateTime field with proper type inference
    const date = new Date('2023-01-01');
    const dateExpr = t.user.createdAt.eq(date);
    expect(dateExpr.value).toBe(date);
    expect(dateExpr.value instanceof Date).toBe(true);

    // Test that operators work with different types
    const intGtExpr = t.user.id.gt(100);
    expect(intGtExpr.value).toBe(100);

    const stringNeExpr = t.user.email.ne('invalid@example.com');
    expect(stringNeExpr.value).toBe('invalid@example.com');

    const boolEqExpr = t.user.active.eq(false);
    expect(boolEqExpr.value).toBe(false);
  });

  it('handles empty schema gracefully', () => {
    const emptySchema = { models: [] };
    const t = makeT<{}>(emptySchema);

    expect(t).toEqual({});
    expect(Object.keys(t)).toHaveLength(0);
  });

  it('handles model with no fields', () => {
    const schemaWithEmptyModel = {
      models: [
        {
          name: 'EmptyModel',
          fields: []
        }
      ]
    };

    interface EmptyTables {
      emptymodel: Table<{}>;
    }

    const t = makeT<EmptyTables>(schemaWithEmptyModel);

    expect(t).toHaveProperty('emptymodel');
    expect(t.emptymodel[TABLE_NAME]).toBe('emptymodel');
    expect(Object.getOwnPropertySymbols(t.emptymodel)).toEqual([TABLE_NAME]);
  });

  it('converts model names to lowercase', () => {
    const t = makeT<TestTables>(mockSchema);

    expect(t.user).toBeDefined();
    expect(t.post).toBeDefined();
    expect(t.User).toBeUndefined();
    expect(t.Post).toBeUndefined();

    // Verify the actual table names are lowercase
    expect(t.user[TABLE_NAME]).toBe('user');
    expect(t.post[TABLE_NAME]).toBe('post');
  });

  it('preserves field names exactly', () => {
    const t = makeT<TestTables>(mockSchema);

    // Field names should be preserved exactly
    expect(t.user.id).toBeDefined();
    expect(t.user.email).toBeDefined();
    expect(t.user.active).toBeDefined();
    expect(t.user.createdAt).toBeDefined();

    // Check that field names in expressions match
    expect(t.user.id.eq(1).field).toBe('id');
    expect(t.user.email.eq('test').field).toBe('email');
    expect(t.user.active.eq(true).field).toBe('active');
    expect(t.user.createdAt.eq(new Date()).field).toBe('createdAt');
  });

  it('returns typed result when generic parameter is provided', () => {
    const t = makeT<TestTables>(mockSchema);

    // TypeScript should infer the correct types
    // This test mainly ensures the function signature works
    expect(t.user).toBeDefined();
    expect(t.user.id).toBeDefined();
    expect(t.user.email).toBeDefined();

    // Verify type safety by checking that we can access properties
    const userId: Column<number> = t.user.id;
    const userEmail: Column<string> = t.user.email;
    const userActive: Column<boolean> = t.user.active;
    const userCreatedAt: Column<Date> = t.user.createdAt;

    expect(userId.name).toBe('id');
    expect(userEmail.name).toBe('email');
    expect(userActive.name).toBe('active');
    expect(userCreatedAt.name).toBe('createdAt');
  });
});
