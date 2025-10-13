import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection, createRuntime, verification } from '../src/exports';
import { Schema, validateContract } from '@prisma/relational-ir';
import { sql, makeT, rawSql } from '@prisma/sql';

describe('Runtime Verification Tests', () => {
  let db: DatabaseConnection;
  let runtime: any;
  let mockSchema: Schema;

  beforeEach(() => {
    mockSchema = validateContract({
      target: 'postgres',
      contractHash: 'sha256:test123',
      tables: {
        user: {
          columns: {
            id: { type: 'int4', nullable: false, pk: true },
            email: { type: 'text', nullable: false, unique: true },
            active: { type: 'bool', nullable: false, default: { kind: 'literal', value: 'true' } },
            createdAt: { type: 'timestamptz', nullable: false, default: { kind: 'now' } },
          },
          primaryKey: { kind: 'primaryKey', columns: ['id'] },
          uniques: [{ kind: 'unique', columns: ['email'] }],
          foreignKeys: [],
          indexes: [],
        },
      },
    });

    db = new DatabaseConnection({
      ir: mockSchema,
      database: {
        host: 'localhost',
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        password: 'postgres',
      },
    });

    runtime = createRuntime({
      ir: mockSchema,
      driver: db,
      plugins: [verification({ mode: 'onFirstUse' })],
    });
  });

  afterEach(async () => {
    if (db) {
      await db.end();
    }
  });

  it('throws error for unknown table', async () => {
    const t = makeT(mockSchema);

    // Create a query that references a non-existent table
    const query = sql(mockSchema)
      .from('nonexistent' as any)
      .select({ id: (t as any).user.id })
      .build();

    await expect(runtime.execute(query)).rejects.toThrow(
      "Table 'nonexistent' does not exist in schema",
    );
  });

  it('throws error for unknown column', async () => {
    const t = makeT(mockSchema);

    // Create a query that references a non-existent column by using selectRaw
    const query = sql(mockSchema)
      .from((t as any).user)
      .selectRaw([
        { alias: 'nonexistent', expr: { kind: 'column', table: 'user', name: 'nonexistent' } },
      ])
      .build();

    await expect(runtime.execute(query)).rejects.toThrow(
      "Column 'nonexistent' does not exist in table 'user'",
    );
  });

  it('verifies schema on first use', async () => {
    const t = makeT(mockSchema);

    // Create a valid query that should trigger schema verification
    const query = sql(mockSchema)
      .from((t as any).user)
      .select({ id: (t as any).user.id })
      .build();

    // This should work if the database is available, or fail if not
    // We'll just test that the query can be built and executed
    const result = await runtime.execute(query);
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles raw SQL queries', async () => {
    const query = rawSql('SELECT 1 as test');

    // Raw SQL queries should work without verification
    const result = await runtime.execute(query);
    expect(result).toEqual([{ test: 1 }]);
  });
});
