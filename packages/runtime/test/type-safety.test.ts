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

interface TestTables {
  user: Table<UserShape>;
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
  },
};

const t = makeT<TestTables>(mockSchema);

// Mock DatabaseConnection for testing
class MockDatabaseConnection extends DatabaseConnection {
  constructor() {
    super({ ir: mockSchema as any });
  }

  async execute<TResult = any>(query: any): Promise<TResult[]> {
    // Mock implementation that returns typed results
    if (query.sql.includes('SELECT "id" AS "id", "email" AS "email"')) {
      return [
        { id: 1, email: 'test@example.com' },
        { id: 2, email: 'test2@example.com' },
      ] as TResult[];
    }
    if (query.sql.includes('SELECT "email" AS "email"')) {
      return [{ email: 'test@example.com' }, { email: 'test2@example.com' }] as TResult[];
    }
    return [] as TResult[];
  }
}

describe('Runtime Type Safety', () => {
  let runtime: Runtime;
  let mockDriver: MockDatabaseConnection;

  beforeEach(() => {
    mockDriver = new MockDatabaseConnection();
    runtime = createRuntime({
      ir: mockSchema as any,
      driver: mockDriver,
    });
  });

  it('returns properly typed results from execute()', async () => {
    const query = sql(mockSchema).from(t.user).select({ id: t.user.id, email: t.user.email });

    const plan = query.build(); // Plan<{ id: number; email: string }>

    const result = await runtime.execute(plan);

    // TypeScript should infer result as { id: number; email: string }[]
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('email');
    expect(typeof result[0].id).toBe('number');
    expect(typeof result[0].email).toBe('string');
  });

  it('returns single column typed results', async () => {
    const query = sql(mockSchema).from(t.user).select({ email: t.user.email });

    const plan = query.build(); // Plan<{ email: string }>

    const result = await runtime.execute(plan);

    // TypeScript should infer result as { email: string }[]
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('email');
    expect(typeof result[0].email).toBe('string');
    // Should not have id property
    expect(result[0]).not.toHaveProperty('id');
  });

  it('prevents execution of Plan<never>', () => {
    const query = sql(mockSchema).from(t.user);
    const plan = query.build(); // Plan<never>

    // This should cause a TypeScript error if uncommented:
    // const result = await runtime.execute(plan); // Error: Argument of type 'Plan<never>' is not assignable to parameter of type 'Plan<TResult>'

    // Instead, we verify the type is never
    const planType: Plan<never> = plan;
    expect(planType).toBeDefined();
  });
});

// Type-only tests to verify compile-time behavior
describe('Compile-time Runtime Type Safety', () => {
  it('execute() returns Promise<TResult[]>', async () => {
    const mockDriver = new MockDatabaseConnection();
    const runtime = createRuntime({
      ir: mockSchema as any,
      driver: mockDriver,
    });

    const query = sql(mockSchema).from(t.user).select({ id: t.user.id, email: t.user.email });

    const plan = query.build(); // Plan<{ id: number; email: string }>

    // This should be allowed by TypeScript and return Promise<{ id: number; email: string }[]>
    const resultPromise: Promise<{ id: number; email: string }[]> = runtime.execute(plan);
    const result = await resultPromise;

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('email');
  });
});
