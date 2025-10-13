import { describe, it, expect } from 'vitest';
import { sql, makeT, TABLE_NAME } from '../src/exports';
import type { Column, FieldExpression, Tables, Table, Plan } from '../src/types';
import { validateContract } from '@prisma/relational-ir';

interface UserShape {
  id: number;
  email: string;
  active: boolean;
  createdAt: Date;
}

interface TestTables {
  user: Table<UserShape>;
}

const mockSchema = validateContract({
  target: 'postgres' as const,
  contractHash: 'test-hash',
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
});

const t = makeT<TestTables>(mockSchema);

describe('Type Safety', () => {
  it('returns Plan<never> when no select() is called', () => {
    const query = sql(mockSchema).from(t.user);
    const plan = query.build();

    // TypeScript should infer this as Plan<never>
    const planType: Plan<never> = plan;
    expect(planType).toBeDefined();
  });

  it('returns properly typed Plan when select() is called', () => {
    const query = sql(mockSchema).from(t.user).select({ id: t.user.id, email: t.user.email });

    const plan = query.build();

    // TypeScript should infer this as Plan<{ id: number; email: string }>
    const planType: Plan<{ id: number; email: string }> = plan;
    expect(planType).toBeDefined();
  });

  it('preserves result type through method chaining', () => {
    const query = sql(mockSchema)
      .from(t.user)
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('createdAt', 'DESC')
      .limit(10);

    const plan = query.build();

    // Should still be Plan<{ id: number; email: string }> after all operations
    const planType: Plan<{ id: number; email: string }> = plan;
    expect(planType).toBeDefined();
  });

  it('handles single column selection', () => {
    const query = sql(mockSchema).from(t.user).select({ email: t.user.email });

    const plan = query.build();

    // Should be Plan<{ email: string }>
    const planType: Plan<{ email: string }> = plan;
    expect(planType).toBeDefined();
  });

  it('handles all columns selection', () => {
    const query = sql(mockSchema).from(t.user).select({
      id: t.user.id,
      email: t.user.email,
      active: t.user.active,
      createdAt: t.user.createdAt,
    });

    const plan = query.build();

    // Should be Plan<UserShape>
    const planType: Plan<UserShape> = plan;
    expect(planType).toBeDefined();
  });
});

// Type-only tests to verify compile-time behavior
describe('Compile-time Type Safety', () => {
  it('prevents execution of Plan<never>', () => {
    const query = sql(mockSchema).from(t.user);
    const plan = query.build(); // Plan<never>

    // This should cause a TypeScript error if uncommented:
    // const result = await runtime.execute(plan); // Error: Argument of type 'Plan<never>' is not assignable to parameter of type 'Plan<TResult>'

    // Instead, we verify the type is never
    const planType: Plan<never> = plan;
    expect(planType).toBeDefined();
  });

  it('allows execution of properly typed Plan', () => {
    const query = sql(mockSchema).from(t.user).select({ id: t.user.id, email: t.user.email });

    const plan = query.build(); // Plan<{ id: number; email: string }>

    // This should be allowed by TypeScript:
    // const result = await runtime.execute(plan); // Returns Promise<{ id: number; email: string }[]>

    const planType: Plan<{ id: number; email: string }> = plan;
    expect(planType).toBeDefined();
  });

  it('handles aliased select fields with proper type inference', () => {
    const query = sql(mockSchema).from(t.user).select({
      userId: t.user.id,
      userEmail: t.user.email,
      isActive: t.user.active,
    });

    const plan = query.build();

    // TypeScript should infer this as Plan<{ userId: number; userEmail: string; isActive: boolean }>
    const planType: Plan<{ userId: number; userEmail: string; isActive: boolean }> = plan;
    expect(planType).toBeDefined();

    // Verify the SQL contains proper AS clauses
    expect(plan.sql).toContain('"id" AS "userId"');
    expect(plan.sql).toContain('"email" AS "userEmail"');
    expect(plan.sql).toContain('"active" AS "isActive"');
  });

  it('handles mixed aliased and non-aliased select fields', () => {
    const query = sql(mockSchema).from(t.user).select({
      id: t.user.id, // No alias
      userEmail: t.user.email, // Aliased
      active: t.user.active, // No alias
    });

    const plan = query.build();

    // TypeScript should infer this as Plan<{ id: number; userEmail: string; active: boolean }>
    const planType: Plan<{ id: number; userEmail: string; active: boolean }> = plan;
    expect(planType).toBeDefined();

    // Verify the SQL contains both aliased and non-aliased fields
    expect(plan.sql).toContain('"id" AS "id"');
    expect(plan.sql).toContain('"email" AS "userEmail"');
    expect(plan.sql).toContain('"active" AS "active"');
  });

  it('verifies contract hash validation works with aliased selects', () => {
    // Create a mock column with different contract hash
    const mismatchedColumn = {
      ...t.user.id,
      __contractHash: 'different-hash',
    };

    // This should throw an error due to contract hash mismatch
    expect(() => {
      sql(mockSchema).from(t.user).select({
        userId: mismatchedColumn,
        userEmail: t.user.email,
      });
    }).toThrow('E_CONTRACT_MISMATCH');
  });
});
