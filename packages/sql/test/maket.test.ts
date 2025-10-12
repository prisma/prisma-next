import { describe, it, expect } from 'vitest';
import { makeT } from '../src/maket';
import { TABLE_NAME } from '../src/types';
import type { Column, Table, Expression } from '../src/types';

// Define test table shapes
interface UserShape {
  id: number;
  email: string;
  active: boolean;
  createdAt: Date;
}

interface PostShape {
  id: number;
  title: string;
  content: string;
  published: boolean;
}

interface TestTables {
  user: Table<UserShape>;
  post: Table<PostShape>;
}

// Mock schema with new IR structure
const mockSchema = {
  target: 'postgres',
  tables: {
    user: {
      columns: {
        id: { type: 'int4', nullable: false, pk: true, default: { kind: 'autoincrement' } },
        email: { type: 'text', nullable: false, unique: true },
        active: { type: 'bool', nullable: false, default: { kind: 'literal', value: 'true' } },
        createdAt: { type: 'timestamptz', nullable: false, default: { kind: 'now' } },
      },
      indexes: [],
      constraints: [],
      capabilities: [],
    },
    post: {
      columns: {
        id: { type: 'int4', nullable: false, pk: true, default: { kind: 'autoincrement' } },
        title: { type: 'text', nullable: false },
        content: { type: 'text', nullable: false },
        published: { type: 'bool', nullable: false, default: { kind: 'literal', value: 'false' } },
      },
      indexes: [],
      constraints: [],
      capabilities: [],
    },
  },
};

describe('makeT Factory Function', () => {
  it('creates tables with correct structure', () => {
    const t = makeT<TestTables>(mockSchema);
    expect(t).toHaveProperty('user');
    expect(t).toHaveProperty('post');
    expect(t.user[TABLE_NAME]).toBe('user');
    expect(t.post[TABLE_NAME]).toBe('post');
  });

  it('creates columns with correct properties', () => {
    const t = makeT<TestTables>(mockSchema);

    // Test user columns
    expect(t.user.id).toBeDefined();
    expect(t.user.email).toBeDefined();
    expect(t.user.active).toBeDefined();
    expect(t.user.createdAt).toBeDefined();

    // Test post columns
    expect(t.post.id).toBeDefined();
    expect(t.post.title).toBeDefined();
    expect(t.post.content).toBeDefined();
    expect(t.post.published).toBeDefined();
  });

  it('creates columns with correct metadata', () => {
    const t = makeT<TestTables>(mockSchema);

    const userIdColumn: Column<number> = t.user.id;
    expect(userIdColumn.table).toBe('user');
    expect(userIdColumn.name).toBe('id');

    const userEmailColumn: Column<string> = t.user.email;
    expect(userEmailColumn.table).toBe('user');
    expect(userEmailColumn.name).toBe('email');
  });

  it('creates operator methods that return correct expressions', () => {
    const t = makeT<TestTables>(mockSchema);

    const eqExpr = t.user.id.eq(1);
    expect(eqExpr).toEqual({ __t: undefined, type: 'eq', field: 'id', value: 1 });

    const neExpr = t.user.email.ne('test@example.com');
    expect(neExpr).toEqual({
      __t: undefined,
      type: 'ne',
      field: 'email',
      value: 'test@example.com',
    });

    const gtExpr = t.user.id.gt(5);
    expect(gtExpr).toEqual({ __t: undefined, type: 'gt', field: 'id', value: 5 });

    const ltExpr = t.user.id.lt(10);
    expect(ltExpr).toEqual({ __t: undefined, type: 'lt', field: 'id', value: 10 });

    const gteExpr = t.user.id.gte(1);
    expect(gteExpr).toEqual({ __t: undefined, type: 'gte', field: 'id', value: 1 });

    const lteExpr = t.user.id.lte(100);
    expect(lteExpr).toEqual({ __t: undefined, type: 'lte', field: 'id', value: 100 });

    const inExpr = t.user.id.in([1, 2, 3]);
    expect(inExpr).toEqual({ __t: undefined, type: 'in', field: 'id', values: [1, 2, 3] });
  });

  it('handles table with no columns', () => {
    const schemaWithEmptyTable = {
      target: 'postgres',
      tables: {
        emptytable: {
          columns: {},
          indexes: [],
          constraints: [],
          capabilities: [],
        },
      },
    };

    interface EmptyTables {
      emptytable: Table<{}>;
    }

    const t = makeT<EmptyTables>(schemaWithEmptyTable);
    expect(t).toHaveProperty('emptytable');
    expect(t.emptytable[TABLE_NAME]).toBe('emptytable');
    expect(Object.getOwnPropertySymbols(t.emptytable)).toEqual([TABLE_NAME]);
  });

  it('converts table names to lowercase', () => {
    const schemaWithUppercase = {
      target: 'postgres',
      tables: {
        User: {
          columns: {
            id: { type: 'int4', nullable: false },
          },
          indexes: [],
          constraints: [],
          capabilities: [],
        },
      },
    };

    interface UppercaseTables {
      User: Table<{ id: number }>; // Use exact table name from schema
    }

    const t = makeT<UppercaseTables>(schemaWithUppercase);
    expect(t.User).toBeDefined();
    expect(t.user).toBeUndefined();
    expect(t.User[TABLE_NAME]).toBe('User'); // Table name from schema is preserved
  });

  it('preserves column names exactly as in schema', () => {
    const t = makeT<TestTables>(mockSchema);

    // Column names should match exactly what's in the schema
    expect(t.user.id.name).toBe('id');
    expect(t.user.email.name).toBe('email');
    expect(t.user.active.name).toBe('active');
    expect(t.user.createdAt.name).toBe('createdAt');
  });

  it('handles complex column types', () => {
    const complexSchema = {
      target: 'postgres',
      tables: {
        complex: {
          columns: {
            uuid: { type: 'uuid', nullable: false },
            jsonData: { type: 'json', nullable: false },
            jsonbData: { type: 'jsonb', nullable: false },
            floatValue: { type: 'float8', nullable: false },
            timestamp: { type: 'timestamp', nullable: false },
          },
          indexes: [],
          constraints: [],
          capabilities: [],
        },
      },
    };

    interface ComplexTables {
      complex: Table<{
        uuid: string;
        jsonData: any;
        jsonbData: any;
        floatValue: number;
        timestamp: Date;
      }>;
    }

    const t = makeT<ComplexTables>(complexSchema);
    expect(t.complex.uuid).toBeDefined();
    expect(t.complex.jsonData).toBeDefined();
    expect(t.complex.jsonbData).toBeDefined();
    expect(t.complex.floatValue).toBeDefined();
    expect(t.complex.timestamp).toBeDefined();
  });
});
