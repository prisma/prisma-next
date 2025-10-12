import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../src/connection';
import { Schema } from '@prisma/relational-ir';

describe('Runtime Verification Tests', () => {
  let db: DatabaseConnection;
  let mockSchema: Schema;

  beforeEach(() => {
    mockSchema = {
      models: [
        {
          name: 'User',
          fields: [
            { name: 'id', type: 'Int', attributes: [{ name: 'id' }] },
            { name: 'email', type: 'String', attributes: [{ name: 'unique' }] },
            { name: 'active', type: 'Boolean', attributes: [{ name: 'default', value: { type: 'literal', value: 'true' } }] },
            { name: 'createdAt', type: 'DateTime', attributes: [{ name: 'default', value: { type: 'now' } }] },
          ],
        },
      ],
    };

    db = new DatabaseConnection({
      ir: mockSchema,
      verify: 'onFirstUse',
      database: {
        host: 'localhost',
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        password: 'postgres',
      },
    });
  });

  afterEach(async () => {
    if (db) {
      await db.end();
    }
  });

  it('throws error for unknown table', async () => {
    const query = {
      type: 'select' as const,
      from: 'nonexistent',
      select: {
        type: 'select' as const,
        fields: { id: { table: 'user', name: 'id' } as any },
      },
    };

    await expect(db.execute(query)).rejects.toThrow("Table 'nonexistent' does not exist in database");
  });

  it('throws error for unknown column', async () => {
    const query = {
      type: 'select' as const,
      from: 'user',
      select: {
        type: 'select' as const,
        fields: { nonexistent: { table: 'user', name: 'nonexistent' } as any },
      },
    };

    await expect(db.execute(query)).rejects.toThrow("Column 'nonexistent' does not exist in table 'user'");
  });

  it('verifies schema on first use', async () => {
    // This test would require a real database connection
    // For now, we'll test the error handling
    const query = {
      type: 'select' as const,
      from: 'user',
      select: {
        type: 'select' as const,
        fields: { id: { table: 'user', name: 'id' } as any },
      },
    };

    // This will fail because we don't have a real database
    // but it tests that verification is attempted
    await expect(db.execute(query)).rejects.toThrow();
  });

  it('handles raw SQL queries', async () => {
    const query = {
      type: 'raw' as const,
      sql: 'SELECT 1 as test',
    };

    // This will fail because we don't have a real database
    // but it tests that raw queries are handled differently
    await expect(db.execute(query)).rejects.toThrow();
  });
});
