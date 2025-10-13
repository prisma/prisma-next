import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { sql } from '@prisma/sql';
import { makeT } from '@prisma/sql';
import type { Table } from '@prisma/sql';
import { connect } from '../src/exports';

describe('Runtime Integration Tests', () => {
  let db: any;
  let postgresProcess: any;

  // Define our test schema types
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
    contractHash: 'sha256:test123',
    tables: {
      user: {
        columns: {
          id: { type: 'int4' as const, nullable: false, pk: true },
          email: { type: 'text' as const, nullable: false, unique: true },
          active: { type: 'bool' as const, nullable: false, default: { kind: 'literal' as const, value: 'true' } },
          createdAt: { type: 'timestamptz' as const, nullable: false, default: { kind: 'now' as const } },
        },
        indexes: [],
        constraints: [],
        capabilities: [],
      },
    },
  };

  beforeAll(async () => {
    // Start PostgreSQL using @prisma/dev
    postgresProcess = spawn('npx', ['@prisma/dev', 'postgres'], {
      stdio: 'pipe',
      env: { ...process.env }
    });

    // Wait for PostgreSQL to be ready
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Connect to database
    db = connect({
      ir: mockSchema,
      verify: 'onFirstUse',
      database: {
        host: 'localhost',
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        password: 'postgres'
      }
    });

    // Create test table
    await db.execute({
      type: 'raw',
      sql: `
        CREATE TABLE IF NOT EXISTS "user" (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          active BOOLEAN DEFAULT true,
          "createdAt" TIMESTAMP DEFAULT NOW()
        );
      `,
    });

    // Insert test data
    await db.execute({
      type: 'raw',
      sql: `
        INSERT INTO "user" (email, active, "createdAt") VALUES
        ('test1@example.com', true, NOW()),
        ('test2@example.com', false, NOW()),
        ('test3@example.com', true, NOW())
        ON CONFLICT (email) DO NOTHING;
      `,
    });
  }, 10000);

  afterAll(async () => {
    if (postgresProcess) {
      postgresProcess.kill();
    }
  });

  it('executes basic SELECT query with makeT and sql', async () => {
    const t = makeT<TestTables>(mockSchema);

    const query = sql(mockSchema)
      .from(t.user)
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email });

    console.log('Debug - t.user.id:', t.user.id);
    console.log('Debug - Generated SQL:', query.build().sql);
    console.log('Debug - Parameters:', query.build().params);

    const results = await db.execute(query.build());

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('email');
    expect(typeof results[0].id).toBe('number');
    expect(typeof results[0].email).toBe('string');

    // Verify correct data
    const emails = results.map((r: any) => r.email);
    expect(emails).toContain('test1@example.com');
    expect(emails).toContain('test3@example.com');
    expect(emails).not.toContain('test2@example.com');
  });

  it('executes query with WHERE clause using different operators', async () => {
    const t = makeT<TestTables>(mockSchema);

    // Test eq operator
    const eqQuery = sql(mockSchema)
      .from(t.user)
      .where(t.user.email.eq('test1@example.com'))
      .select({ id: t.user.id, email: t.user.email });

    const eqResults = await db.execute(eqQuery.build());
    expect(eqResults).toHaveLength(1);
    expect(eqResults[0].email).toBe('test1@example.com');

    // Test ne operator
    const neQuery = sql(mockSchema)
      .from(t.user)
      .where(t.user.email.ne('test1@example.com'))
      .select({ id: t.user.id, email: t.user.email });

    const neResults = await db.execute(neQuery.build());
    expect(neResults).toHaveLength(2);
    expect(neResults.every((r: any) => r.email !== 'test1@example.com')).toBe(true);

    // Test gt operator (on id)
    const gtQuery = sql(mockSchema)
      .from(t.user)
      .where(t.user.id.gt(1))
      .select({ id: t.user.id, email: t.user.email });

    const gtResults = await db.execute(gtQuery.build());
    expect(gtResults).toHaveLength(2);
    expect(gtResults.every((r: any) => r.id > 1)).toBe(true);
  });

  it('executes query with LIMIT clause', async () => {
    const t = makeT<TestTables>(mockSchema);

    const query = sql(mockSchema)
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email })
      .limit(2);

    const results = await db.execute(query.build());
    expect(results).toHaveLength(2);
  });

  it('executes query with ORDER BY clause', async () => {
    const t = makeT<TestTables>(mockSchema);

    const query = sql(mockSchema)
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('id', 'ASC');

    const results = await db.execute(query.build());
    expect(results).toHaveLength(3);

    // Verify ordering
    for (let i = 1; i < results.length; i++) {
      expect(results[i].id).toBeGreaterThanOrEqual(results[i - 1].id);
    }
  });

  it('executes query with IN operator', async () => {
    const t = makeT<TestTables>(mockSchema);

    const query = sql(mockSchema)
      .from(t.user)
      .where(t.user.id.in([1, 3]))
      .select({ id: t.user.id, email: t.user.email });

    const results = await db.execute(query.build());
    expect(results).toHaveLength(2);

    const ids = results.map((r: any) => r.id);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2);
  });

  it('handles complex queries with multiple clauses', async () => {
    const t = makeT<TestTables>(mockSchema);

    const query = sql(mockSchema)
      .from(t.user)
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('id', 'ASC')
      .limit(1);

    const results = await db.execute(query.build());
    expect(results).toHaveLength(1);
    expect(results[0].email).toBe('test1@example.com'); // Should be the first active user
  });

  it('verifies type safety in query building', () => {
    const t = makeT<TestTables>(mockSchema);

    // These should compile without TypeScript errors
    const query1 = sql(mockSchema)
      .from(t.user)
      .where(t.user.id.eq(123)) // number
      .select({ id: t.user.id, email: t.user.email });

    const query2 = sql(mockSchema)
      .from(t.user)
      .where(t.user.email.eq('test@example.com')) // string
      .select({ id: t.user.id, email: t.user.email });

    const query3 = sql(mockSchema)
      .from(t.user)
      .where(t.user.active.eq(true)) // boolean
      .select({ id: t.user.id, email: t.user.email });

    const query4 = sql(mockSchema)
      .from(t.user)
      .where(t.user.createdAt.eq(new Date())) // Date
      .select({ id: t.user.id, email: t.user.email });

    // All queries should be buildable
    expect(() => query1.build()).not.toThrow();
    expect(() => query2.build()).not.toThrow();
    expect(() => query3.build()).not.toThrow();
    expect(() => query4.build()).not.toThrow();
  });
});
