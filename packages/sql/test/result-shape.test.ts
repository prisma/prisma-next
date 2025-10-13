import { describe, it, expect } from 'vitest';
import { sql, makeT, TABLE_NAME } from '../src/exports';
import type { Column, FieldExpression, Tables, Table, Plan } from '../src/types';

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
  published: boolean;
}

interface TestTables {
  user: Table<UserShape>;
  post: Table<PostShape>;
}

const mockSchema = {
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
    post: {
      columns: {
        id: {
          type: 'int4' as const,
          nullable: false,
          pk: true,
          default: { kind: 'autoincrement' as const },
        },
        title: { type: 'text' as const, nullable: false },
        userId: { type: 'int4' as const, nullable: false },
        published: {
          type: 'bool' as const,
          nullable: false,
          default: { kind: 'literal' as const, value: 'false' },
        },
      },
      indexes: [],
      constraints: [],
      capabilities: [],
    },
  },
};

const t = makeT<TestTables>(mockSchema);

describe('Result Shape Verification', () => {
  describe('Compile-time Type Safety', () => {
    it('infers correct result type for single column selection', () => {
      const query = sql(mockSchema).from(t.user).select({ id: t.user.id });
      const plan = query.build();

      // TypeScript should infer this as Plan<{ id: number }>
      const planType: Plan<{ id: number }> = plan;
      expect(planType).toBeDefined();

      // Verify the plan has the expected structure
      expect(plan.sql).toBe('SELECT "id" AS "id" FROM "user"');
      expect(plan.params).toHaveLength(0);
    });

    it('infers correct result type for multiple column selection', () => {
      const query = sql(mockSchema)
        .from(t.user)
        .select({ id: t.user.id, email: t.user.email, active: t.user.active });

      const plan = query.build();

      // TypeScript should infer this as Plan<{ id: number; email: string; active: boolean }>
      const planType: Plan<{ id: number; email: string; active: boolean }> = plan;
      expect(planType).toBeDefined();

      expect(plan.sql).toBe(
        'SELECT "id" AS "id", "email" AS "email", "active" AS "active" FROM "user"',
      );
    });

    it('infers correct result type for all columns selection', () => {
      const query = sql(mockSchema).from(t.user).select({
        id: t.user.id,
        email: t.user.email,
        active: t.user.active,
        createdAt: t.user.createdAt,
      });

      const plan = query.build();

      // TypeScript should infer this as Plan<UserShape>
      const planType: Plan<UserShape> = plan;
      expect(planType).toBeDefined();

      expect(plan.sql).toBe(
        'SELECT "id" AS "id", "email" AS "email", "active" AS "active", "createdAt" AS "createdAt" FROM "user"',
      );
    });

    it('infers correct result type for different table', () => {
      const query = sql(mockSchema).from(t.post).select({ id: t.post.id, title: t.post.title });

      const plan = query.build();

      // TypeScript should infer this as Plan<{ id: number; title: string }>
      const planType: Plan<{ id: number; title: string }> = plan;
      expect(planType).toBeDefined();

      expect(plan.sql).toBe('SELECT "id" AS "id", "title" AS "title" FROM "post"');
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

      expect(plan.sql).toBe(
        'SELECT "id" AS "id", "email" AS "email" FROM "user" WHERE "active" = $1 ORDER BY "createdAt" DESC LIMIT $2',
      );
      expect(plan.params).toEqual([true, 10]);
    });

    it('returns Plan<never> when no select() is called', () => {
      const query = sql(mockSchema).from(t.user);
      const plan = query.build();

      // TypeScript should infer this as Plan<never>
      const planType: Plan<never> = plan;
      expect(planType).toBeDefined();

      // Should still generate SQL with SELECT *
      expect(plan.sql).toBe('SELECT * FROM "user"');
    });

    it('prevents execution of Plan<never> at compile time', () => {
      const query = sql(mockSchema).from(t.user);
      const plan = query.build(); // Plan<never>

      // This demonstrates the compile-time safety
      // If you uncomment the line below, TypeScript will error:
      // const result = await runtime.execute(plan); // Error: Argument of type 'Plan<never>' is not assignable to parameter of type 'Plan<TResult>'

      // Instead, we verify the type is never
      const planType: Plan<never> = plan;
      expect(planType).toBeDefined();
    });
  });

  describe('Runtime Shape Verification', () => {
    it('generates correct SQL for single column selection', () => {
      const query = sql(mockSchema).from(t.user).select({ id: t.user.id });
      const plan = query.build();

      expect(plan.sql).toBe('SELECT "id" AS "id" FROM "user"');
      expect(plan.params).toHaveLength(0);
      expect(plan.meta.refs.columns).toContain('user.id');
      expect(plan.meta.refs.tables).toContain('user');
    });

    it('generates correct SQL for multiple column selection', () => {
      const query = sql(mockSchema)
        .from(t.user)
        .select({ id: t.user.id, email: t.user.email, active: t.user.active });

      const plan = query.build();

      expect(plan.sql).toBe(
        'SELECT "id" AS "id", "email" AS "email", "active" AS "active" FROM "user"',
      );
      expect(plan.params).toHaveLength(0);
      expect(plan.meta.refs.columns).toContain('user.id');
      expect(plan.meta.refs.columns).toContain('user.email');
      expect(plan.meta.refs.columns).toContain('user.active');
    });

    it('generates correct SQL with WHERE clause', () => {
      const query = sql(mockSchema)
        .from(t.user)
        .where(t.user.active.eq(true))
        .select({ id: t.user.id, email: t.user.email });

      const plan = query.build();

      expect(plan.sql).toBe(
        'SELECT "id" AS "id", "email" AS "email" FROM "user" WHERE "active" = $1',
      );
      expect(plan.params).toEqual([true]);
    });

    it('generates correct SQL with ORDER BY and LIMIT', () => {
      const query = sql(mockSchema)
        .from(t.user)
        .select({ id: t.user.id, email: t.user.email })
        .orderBy('createdAt', 'DESC')
        .limit(5);

      const plan = query.build();

      expect(plan.sql).toBe(
        'SELECT "id" AS "id", "email" AS "email" FROM "user" ORDER BY "createdAt" DESC LIMIT $1',
      );
      expect(plan.params).toEqual([5]);
    });

    it('generates correct SQL for different table', () => {
      const query = sql(mockSchema)
        .from(t.post)
        .select({ id: t.post.id, title: t.post.title, published: t.post.published });

      const plan = query.build();

      expect(plan.sql).toBe(
        'SELECT "id" AS "id", "title" AS "title", "published" AS "published" FROM "post"',
      );
      expect(plan.meta.refs.tables).toContain('post');
      expect(plan.meta.refs.columns).toContain('post.id');
      expect(plan.meta.refs.columns).toContain('post.title');
      expect(plan.meta.refs.columns).toContain('post.published');
    });

    it('generates SELECT * when no select() is called', () => {
      const query = sql(mockSchema).from(t.user);
      const plan = query.build();

      expect(plan.sql).toBe('SELECT * FROM "user"');
      expect(plan.params).toHaveLength(0);
      expect(plan.meta.refs.tables).toContain('user');
      // No specific columns referenced since it's SELECT *
      expect(plan.meta.refs.columns).toHaveLength(0);
    });

    it('preserves contract hash in plan metadata', () => {
      const query = sql(mockSchema).from(t.user).select({ id: t.user.id });
      const plan = query.build();

      expect(plan.meta.contractHash).toBe('test-hash');
      expect(plan.meta.target).toBe('postgres');
    });
  });

  describe('Type Inference Edge Cases', () => {
    it('handles empty select object', () => {
      const query = sql(mockSchema).from(t.user).select({});
      const plan = query.build();

      // Empty select should still work but generate SELECT *
      expect(plan.sql).toBe('SELECT * FROM "user"');

      // TypeScript should infer this as Plan<{}>
      const planType: Plan<{}> = plan;
      expect(planType).toBeDefined();
    });

    it('handles column aliasing correctly', () => {
      const query = sql(mockSchema).from(t.user).select({
        userId: t.user.id,
        userEmail: t.user.email,
        isActive: t.user.active,
      });

      const plan = query.build();

      expect(plan.sql).toBe(
        'SELECT "id" AS "userId", "email" AS "userEmail", "active" AS "isActive" FROM "user"',
      );

      // TypeScript should infer this as Plan<{ userId: number; userEmail: string; isActive: boolean }>
      const planType: Plan<{ userId: number; userEmail: string; isActive: boolean }> = plan;
      expect(planType).toBeDefined();
    });

    it('handles complex query with all clauses', () => {
      const query = sql(mockSchema)
        .from(t.user)
        .where(t.user.active.eq(true))
        .select({ id: t.user.id, email: t.user.email })
        .orderBy('email', 'ASC')
        .orderBy('id', 'DESC')
        .limit(100);

      const plan = query.build();

      expect(plan.sql).toBe(
        'SELECT "id" AS "id", "email" AS "email" FROM "user" WHERE "active" = $1 ORDER BY "email" ASC, "id" DESC LIMIT $2',
      );
      expect(plan.params).toEqual([true, 100]);

      // TypeScript should still infer correct result type
      const planType: Plan<{ id: number; email: string }> = plan;
      expect(planType).toBeDefined();
    });
  });

  describe('Column Type Branding', () => {
    it('verifies column objects have correct metadata', () => {
      // Verify that column objects have the expected structure
      expect(t.user.id).toHaveProperty('table', 'user');
      expect(t.user.id).toHaveProperty('name', 'id');
      expect(t.user.id).toHaveProperty('__contractHash', 'test-hash');
      expect(t.user.id).toHaveProperty('eq');
      expect(t.user.id).toHaveProperty('ne');
      expect(t.user.id).toHaveProperty('gt');
      expect(t.user.id).toHaveProperty('lt');
      expect(t.user.id).toHaveProperty('gte');
      expect(t.user.id).toHaveProperty('lte');
      expect(t.user.id).toHaveProperty('in');
    });

    it('verifies column expressions work correctly', () => {
      const eqExpr = t.user.id.eq(42);
      expect(eqExpr).toHaveProperty('kind', 'eq');
      expect(eqExpr).toHaveProperty('left');
      expect(eqExpr).toHaveProperty('right');
      expect(eqExpr.right).toHaveProperty('value', 42);

      const inExpr = t.user.id.in([1, 2, 3]);
      expect(inExpr).toHaveProperty('kind', 'in');
      expect(inExpr).toHaveProperty('left');
      expect(inExpr).toHaveProperty('right');
      expect(inExpr.right).toHaveLength(3);
    });
  });
});
