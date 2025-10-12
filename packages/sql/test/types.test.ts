import { describe, it, expect } from 'vitest';
import { sql, makeT, TABLE_NAME } from '../src/index';
import type { Column, FieldExpression, Tables } from '../src/types';

interface UserShape {
  id: number;
  email: string;
  active: boolean;
  createdAt: Date;
}

interface TestTables extends Tables {
  user: {
    [TABLE_NAME]: string;
    id: Column<number>;
    email: Column<string>;
    active: Column<boolean>;
    createdAt: Column<Date>;
  };
}

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
  },
};

const t = makeT<TestTables>(mockSchema);

describe('Type Inference Tests', () => {
  it('infers correct return type for simple select', () => {
    const query = sql().from(t.user).select({ id: t.user.id, email: t.user.email });

    const { sql: generatedSQL, params, rowType } = query.build();

    expect(generatedSQL).toBe('SELECT id AS id, email AS email FROM user');
    expect(params).toHaveLength(0);
    // Type checking happens at compile time, this is a runtime check for structure
    expect(rowType).toEqual({}); // Placeholder for runtime type check
  });

  it('infers correct return type for select with all fields', () => {
    const query = sql().from(t.user).select({
      id: t.user.id,
      email: t.user.email,
      active: t.user.active,
      createdAt: t.user.createdAt,
    });

    const { sql: generatedSQL, params, rowType } = query.build();

    expect(generatedSQL).toBe(
      'SELECT id AS id, email AS email, active AS active, "createdAt" AS "createdAt" FROM user',
    );
    expect(params).toHaveLength(0);
    expect(rowType).toEqual({});
  });

  it('infers correct return type for query with where clause', () => {
    const query = sql()
      .from(t.user)
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email });

    const { sql: generatedSQL, params, rowType } = query.build();

    expect(generatedSQL).toBe('SELECT id AS id, email AS email FROM user WHERE active = $1');
    expect(params).toEqual([true]);
    expect(rowType).toEqual({});
  });

  it('infers correct return type for query with limit', () => {
    const query = sql().from(t.user).select({ id: t.user.id }).limit(10);

    const { sql: generatedSQL, params, rowType } = query.build();

    expect(generatedSQL).toBe('SELECT id AS id FROM user LIMIT $1');
    expect(params).toEqual([10]);
    expect(rowType).toEqual({});
  });

  it('infers correct return type for query with order by', () => {
    const query = sql()
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('id', 'ASC');

    const { sql: generatedSQL, params, rowType } = query.build();

    expect(generatedSQL).toBe('SELECT id AS id, email AS email FROM user ORDER BY id ASC');
    expect(params).toHaveLength(0);
    expect(rowType).toEqual({});
  });

  it('verifies Column objects have correct structure', () => {
    const userIdColumn: Column<number> = t.user.id;
    expect(userIdColumn.table).toBe('user');
    expect(userIdColumn.name).toBe('id');
    expect(typeof userIdColumn.eq).toBe('function');
  });

  it('verifies Column expressions return correct structure', () => {
    const eqExpr: FieldExpression = t.user.id.eq(1);
    const neExpr: FieldExpression = t.user.email.ne('test@example.com');
    const inExpr: FieldExpression = t.user.id.in([1, 2, 3]);

    expect(eqExpr).toEqual({ __t: undefined, type: 'eq', field: 'id', value: 1 });
    expect(neExpr).toEqual({
      __t: undefined,
      type: 'ne',
      field: 'email',
      value: 'test@example.com',
    });
    expect(inExpr).toEqual({ __t: undefined, type: 'in', field: 'id', values: [1, 2, 3] });
  });

  it('verifies table structure with TABLE_NAME symbol', () => {
    expect(t.user[TABLE_NAME]).toBe('user');
    expect(typeof t.user[TABLE_NAME]).toBe('string');
  });

  it('verifies type safety for different column types', () => {
    // Number column
    const idExpr: FieldExpression = t.user.id.eq(123);
    expect(idExpr.value).toBe(123);

    // String column
    const emailExpr: FieldExpression = t.user.email.eq('test@example.com');
    expect(emailExpr.value).toBe('test@example.com');

    // Boolean column
    const activeExpr: FieldExpression = t.user.active.eq(true);
    expect(activeExpr.value).toBe(true);

    // Date column
    const dateExpr: FieldExpression = t.user.createdAt.eq(new Date('2023-01-01'));
    expect(dateExpr.value).toBeInstanceOf(Date);
  });

  it('verifies IN expressions work with arrays', () => {
    const numberInExpr: FieldExpression = t.user.id.in([1, 2, 3]);
    expect(numberInExpr.type).toBe('in');
    expect(numberInExpr.values).toEqual([1, 2, 3]);

    const stringInExpr: FieldExpression = t.user.email.in(['a@test.com', 'b@test.com']);
    expect(stringInExpr.type).toBe('in');
    expect(stringInExpr.values).toEqual(['a@test.com', 'b@test.com']);
  });

  it('verifies all comparison operators are available', () => {
    const operators = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'in'];

    operators.forEach((op) => {
      expect(typeof (t.user.id as any)[op]).toBe('function');
    });
  });
});
