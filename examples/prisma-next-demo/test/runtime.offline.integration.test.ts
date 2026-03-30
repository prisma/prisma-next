import { describe, expect, it } from 'vitest';
import { db } from '../src/prisma/db';

describe('static context (no runtime)', () => {
  it('schema tables are accessible without runtime', () => {
    const tables = db.schema.tables;
    expect(tables.user).toBeDefined();
    expect(tables.post).toBeDefined();
    expect(tables.user.columns.id).toBeDefined();
    expect(tables.user.columns.email).toBeDefined();
  });

  it('execution context exposes contract metadata', () => {
    const { context } = db;
    expect(context.contract).toBeDefined();
    expect(context.contract.target).toBe('postgres');
    expect(context.contract.storage.tables).toBeDefined();
  });
});
