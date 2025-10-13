import { describe, it, expect, beforeEach } from 'vitest';
import { Runtime, createRuntime } from '../src/runtime';
import { DatabaseConnection } from '../src/connection';
import { sql, makeT } from '@prisma/sql';
import type { Plan } from '@prisma/sql';

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

// Mock DatabaseConnection that returns predictable results
class MockDatabaseConnection extends DatabaseConnection {
  constructor() {
    super({ ir: mockSchema as any });
  }

  async execute<TResult = any>(query: any): Promise<TResult[]> {
    // Mock implementation that returns typed results based on SQL
    if (query.sql.includes('SELECT "id" AS "id", "email" AS "email" FROM "user"')) {
      return [
        { id: 1, email: 'alice@example.com' },
        { id: 2, email: 'bob@example.com' },
        { id: 3, email: 'charlie@example.com' },
      ] as TResult[];
    }

    if (query.sql.includes('SELECT "id" AS "id" FROM "user"')) {
      return [{ id: 1 }, { id: 2 }, { id: 3 }] as TResult[];
    }

    if (query.sql.includes('SELECT "email" AS "email" FROM "user"')) {
      return [
        { email: 'alice@example.com' },
        { email: 'bob@example.com' },
        { email: 'charlie@example.com' },
      ] as TResult[];
    }

    if (query.sql.includes('SELECT "id" AS "id", "title" AS "title" FROM "post"')) {
      return [
        { id: 1, title: 'First Post' },
        { id: 2, title: 'Second Post' },
      ] as TResult[];
    }

    if (query.sql.includes('SELECT "id" AS "userId", "email" AS "userEmail"')) {
      return [
        { userId: 1, userEmail: 'alice@example.com' },
        { userId: 2, userEmail: 'bob@example.com' },
      ] as TResult[];
    }

    if (
      query.sql.includes(
        'SELECT "id" AS "id", "email" AS "email", "active" AS "active" FROM "user"',
      )
    ) {
      return [
        { id: 1, email: 'alice@example.com', active: true },
        { id: 2, email: 'bob@example.com', active: false },
        { id: 3, email: 'charlie@example.com', active: true },
      ] as TResult[];
    }

    // Default fallback
    return [] as TResult[];
  }
}

describe('Runtime Result Shape Verification', () => {
  let runtime: Runtime;
  let mockDriver: MockDatabaseConnection;

  beforeEach(() => {
    mockDriver = new MockDatabaseConnection();
    runtime = createRuntime({
      ir: mockSchema as any,
      driver: mockDriver,
    });
  });

  describe('Single Column Results', () => {
    it('returns correctly shaped results for single column selection', async () => {
      const query = sql(mockSchema).from(t.user).select({ id: t.user.id });
      const plan = query.build(); // Plan<{ id: number }>

      const result = await runtime.execute(plan);

      // Verify runtime shape matches compile-time type
      expect(result).toHaveLength(3);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).not.toHaveProperty('email');
      expect(result[0]).not.toHaveProperty('active');
      expect(typeof result[0].id).toBe('number');

      // Verify all results have the same shape
      result.forEach((row) => {
        expect(row).toHaveProperty('id');
        expect(typeof row.id).toBe('number');
        expect(Object.keys(row)).toEqual(['id']);
      });
    });

    it('returns correctly shaped results for email column', async () => {
      const query = sql(mockSchema).from(t.user).select({ email: t.user.email });
      const plan = query.build(); // Plan<{ email: string }>

      const result = await runtime.execute(plan);

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveProperty('email');
      expect(result[0]).not.toHaveProperty('id');
      expect(typeof result[0].email).toBe('string');

      result.forEach((row) => {
        expect(row).toHaveProperty('email');
        expect(typeof row.email).toBe('string');
        expect(Object.keys(row)).toEqual(['email']);
      });
    });
  });

  describe('Multiple Column Results', () => {
    it('returns correctly shaped results for multiple columns', async () => {
      const query = sql(mockSchema).from(t.user).select({ id: t.user.id, email: t.user.email });

      const plan = query.build(); // Plan<{ id: number; email: string }>

      const result = await runtime.execute(plan);

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('email');
      expect(result[0]).not.toHaveProperty('active');
      expect(typeof result[0].id).toBe('number');
      expect(typeof result[0].email).toBe('string');

      result.forEach((row) => {
        expect(row).toHaveProperty('id');
        expect(row).toHaveProperty('email');
        expect(typeof row.id).toBe('number');
        expect(typeof row.email).toBe('string');
        expect(Object.keys(row).sort()).toEqual(['email', 'id']);
      });
    });

    it('returns correctly shaped results for all columns', async () => {
      const query = sql(mockSchema).from(t.user).select({
        id: t.user.id,
        email: t.user.email,
        active: t.user.active,
      });

      const plan = query.build(); // Plan<{ id: number; email: string; active: boolean }>

      const result = await runtime.execute(plan);

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('email');
      expect(result[0]).toHaveProperty('active');
      expect(typeof result[0].id).toBe('number');
      expect(typeof result[0].email).toBe('string');
      expect(typeof result[0].active).toBe('boolean');

      result.forEach((row) => {
        expect(row).toHaveProperty('id');
        expect(row).toHaveProperty('email');
        expect(row).toHaveProperty('active');
        expect(Object.keys(row).sort()).toEqual(['active', 'email', 'id']);
      });
    });
  });

  describe('Column Aliasing', () => {
    it('returns correctly shaped results with column aliases', async () => {
      const query = sql(mockSchema).from(t.user).select({
        userId: t.user.id,
        userEmail: t.user.email,
      });

      const plan = query.build(); // Plan<{ userId: number; userEmail: string }>

      const result = await runtime.execute(plan);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('userId');
      expect(result[0]).toHaveProperty('userEmail');
      expect(result[0]).not.toHaveProperty('id');
      expect(result[0]).not.toHaveProperty('email');
      expect(typeof result[0].userId).toBe('number');
      expect(typeof result[0].userEmail).toBe('string');

      result.forEach((row) => {
        expect(row).toHaveProperty('userId');
        expect(row).toHaveProperty('userEmail');
        expect(Object.keys(row).sort()).toEqual(['userEmail', 'userId']);
      });
    });
  });

  describe('Different Tables', () => {
    it('returns correctly shaped results for different table', async () => {
      const query = sql(mockSchema).from(t.post).select({ id: t.post.id, title: t.post.title });

      const plan = query.build(); // Plan<{ id: number; title: string }>

      const result = await runtime.execute(plan);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('title');
      expect(result[0]).not.toHaveProperty('email');
      expect(typeof result[0].id).toBe('number');
      expect(typeof result[0].title).toBe('string');

      result.forEach((row) => {
        expect(row).toHaveProperty('id');
        expect(row).toHaveProperty('title');
        expect(Object.keys(row).sort()).toEqual(['id', 'title']);
      });
    });
  });

  describe('Type Safety Verification', () => {
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

    it('allows execution of properly typed Plan', async () => {
      const query = sql(mockSchema).from(t.user).select({ id: t.user.id, email: t.user.email });

      const plan = query.build(); // Plan<{ id: number; email: string }>

      // This should be allowed by TypeScript and return Promise<{ id: number; email: string }[]>
      const resultPromise: Promise<{ id: number; email: string }[]> = runtime.execute(plan);
      const result = await resultPromise;

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('email');
      expect(typeof result[0].id).toBe('number');
      expect(typeof result[0].email).toBe('string');
    });
  });

  describe('Runtime Shape Consistency', () => {
    it('ensures all rows have identical shape', async () => {
      const query = sql(mockSchema).from(t.user).select({ id: t.user.id, email: t.user.email });

      const plan = query.build();
      const result = await runtime.execute(plan);

      // All rows should have the same keys
      const firstRowKeys = Object.keys(result[0]).sort();
      result.forEach((row) => {
        expect(Object.keys(row).sort()).toEqual(firstRowKeys);
      });

      // All rows should have the same value types
      result.forEach((row) => {
        expect(typeof row.id).toBe('number');
        expect(typeof row.email).toBe('string');
      });
    });

    it('handles empty result sets correctly', async () => {
      // Create a query that would return no results
      const query = sql(mockSchema).from(t.user).select({ id: t.user.id, email: t.user.email });

      const plan = query.build();

      // Mock an empty result
      const originalExecute = mockDriver.execute;
      mockDriver.execute = async () => [] as any;

      try {
        const result = await runtime.execute(plan);

        expect(result).toHaveLength(0);
        expect(Array.isArray(result)).toBe(true);
      } finally {
        mockDriver.execute = originalExecute;
      }
    });
  });
});
