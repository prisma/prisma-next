import { describe, it, expect } from 'vitest';
import { sql, makeT, TABLE_NAME } from '../src/exports';
import type { Column, FieldExpression, Tables, Table } from '../src/types';

interface UserShape {
  id: number;
  email: string;
  active: boolean;
  createdAt: Date;
}

interface TestTables {
  user: Table<UserShape>;
}

const mockSchema = {
  target: 'postgres' as const,
  tables: {
    user: {
      columns: {
        id: {
          type: 'int4' as const,
          nullable: false,
          pk: true,
          default: { kind: 'autoincrement' as const },
        },
        email: { type: 'text' as const, nullable: false, unique: true },
        active: {
          type: 'bool' as const,
          nullable: false,
          default: { kind: 'literal' as const, value: 'true' },
        },
        createdAt: {
          type: 'timestamptz' as const,
          nullable: false,
          default: { kind: 'now' as const },
        },
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
    const query = sql(mockSchema)
      .from(t.user as any)
      .select({ id: t.user.id, email: t.user.email });

    const plan = query.build();

    expect(plan.sql).toBe('SELECT "id" AS "id", "email" AS "email" FROM "user"');
    expect(plan.params).toHaveLength(0);
    // Type checking happens at compile time, this is a runtime check for structure
    expect(plan.meta.refs.tables).toEqual(['user']);
  });

  it('infers correct return type for select with all fields', () => {
    const query = sql(mockSchema).from(t.user).select({
      id: t.user.id,
      email: t.user.email,
      active: t.user.active,
      createdAt: t.user.createdAt,
    });

    const plan = query.build();

    expect(plan.sql).toBe(
      'SELECT "id" AS "id", "email" AS "email", "active" AS "active", "createdAt" AS "createdAt" FROM "user"',
    );
    expect(plan.params).toHaveLength(0);
    expect(plan.meta.refs.tables).toEqual(['user']);
  });

  it('infers correct return type for query with where clause', () => {
    const query = sql(mockSchema)
      .from(t.user)
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email });

    const plan = query.build();

    expect(plan.sql).toBe(
      'SELECT "id" AS "id", "email" AS "email" FROM "user" WHERE "active" = $1',
    );
    expect(plan.params).toEqual([true]);
    expect(plan.meta.refs.tables).toEqual(['user']);
  });

  it('infers correct return type for query with limit', () => {
    const query = sql(mockSchema).from(t.user).select({ id: t.user.id }).limit(10);

    const plan = query.build();

    expect(plan.sql).toBe('SELECT "id" AS "id" FROM "user" LIMIT $1');
    expect(plan.params).toEqual([10]);
    expect(plan.meta.refs.tables).toEqual(['user']);
  });

  it('infers correct return type for query with order by', () => {
    const query = sql(mockSchema)
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('id', 'ASC');

    const plan = query.build();

    expect(plan.sql).toBe('SELECT "id" AS "id", "email" AS "email" FROM "user" ORDER BY "id" ASC');
    expect(plan.params).toHaveLength(0);
    expect(plan.meta.refs.tables).toEqual(['user']);
  });

  it('verifies Column objects have correct structure', () => {
    const userIdColumn: Column<'user', 'id', number> = t.user.id;
    expect(userIdColumn.table).toBe('user');
    expect(userIdColumn.name).toBe('id');
    expect(typeof userIdColumn.eq).toBe('function');
  });

  it('verifies Column expressions return correct structure', () => {
    const eqExpr = t.user.id.eq(1);
    const neExpr = t.user.email.ne('test@example.com');
    const inExpr = t.user.id.in([1, 2, 3]);

    expect(eqExpr).toEqual({
      kind: 'eq',
      left: { kind: 'column', name: 'id' },
      right: { kind: 'literal', value: 1 },
    });
    expect(neExpr).toEqual({
      kind: 'ne',
      left: { kind: 'column', name: 'email' },
      right: { kind: 'literal', value: 'test@example.com' },
    });
    expect(inExpr).toEqual({
      kind: 'in',
      left: { kind: 'column', name: 'id' },
      right: [
        { kind: 'literal', value: 1 },
        { kind: 'literal', value: 2 },
        { kind: 'literal', value: 3 },
      ],
    });
  });

  it('verifies table structure with TABLE_NAME symbol', () => {
    expect(t.user[TABLE_NAME]).toBe('user');
    expect(typeof t.user[TABLE_NAME]).toBe('string');
  });

  it('verifies type safety for different column types', () => {
    // Number column
    const idExpr = t.user.id.eq(123);
    expect(idExpr.right.value).toBe(123);

    // String column
    const emailExpr = t.user.email.eq('test@example.com');
    expect(emailExpr.right.value).toBe('test@example.com');

    // Boolean column
    const activeExpr = t.user.active.eq(true);
    expect(activeExpr.right.value).toBe(true);

    // Date column
    const dateExpr = t.user.createdAt.eq(new Date('2023-01-01'));
    expect(dateExpr.right.value).toBeInstanceOf(Date);
  });

  it('verifies IN expressions work with arrays', () => {
    const numberInExpr = t.user.id.in([1, 2, 3]);
    expect(numberInExpr.kind).toBe('in');
    expect(numberInExpr.right).toHaveLength(3);

    const stringInExpr = t.user.email.in(['a@test.com', 'b@test.com']);
    expect(stringInExpr.kind).toBe('in');
    expect(stringInExpr.right).toHaveLength(2);
  });

  it('verifies all comparison operators are available', () => {
    const operators = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'in'];

    operators.forEach((op) => {
      expect(typeof (t.user.id as any)[op]).toBe('function');
    });
  });
});
