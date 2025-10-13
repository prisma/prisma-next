import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { connectAdmin } from '../src/admin-connection';
import { ScriptAST } from '../src/script-ast';

// Mock database connection for testing
const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

describe('AdminConnection', () => {
  let admin: Awaited<ReturnType<typeof connectAdmin>>;

  beforeEach(async () => {
    admin = await connectAdmin(TEST_DB_URL);
    // Clean up any existing contract table
    try {
      await admin.executeScript({
        type: 'script',
        statements: [{
          type: 'raw',
          template: [{ kind: 'rawUnsafe', sql: 'DROP TABLE IF EXISTS prisma_contract' }]
        }]
      });
    } catch (error) {
      // Ignore errors - table might not exist
    }
  });

  afterEach(async () => {
    if (admin) {
      await admin.close();
    }
  });

  it('creates single session successfully', () => {
    expect(admin).toBeDefined();
    expect(admin.target).toBe('postgres');
  });

  it('reads contract hash when table exists', async () => {
    // First write a contract hash (this creates the table)
    await admin.writeContract('sha256:test123');
    
    const result = await admin.readContract();
    expect(result.hash).toBe('sha256:test123');
  });

  it('returns null when contract table does not exist', async () => {
    // Don't create the table, just try to read
    const result = await admin.readContract();
    expect(result.hash).toBeNull();
  });

  it('auto-creates contract table on first write', async () => {
    // Write contract hash - should auto-create table
    await admin.writeContract('sha256:test456');
    
    // Verify we can read it back
    const result = await admin.readContract();
    expect(result.hash).toBe('sha256:test456');
  });

  it('executes simple DDL script', async () => {
    const script: ScriptAST = {
      type: 'script',
      statements: [{
        type: 'createTable',
        name: { name: 'test_table' },
        columns: [
          { name: 'id', type: 'int4', nullable: false },
          { name: 'name', type: 'text', nullable: false }
        ],
        ifNotExists: true
      }]
    };

    const result = await admin.executeScript(script);
    
    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS "test_table"');
    expect(result.sqlHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    
    // Clean up
    await admin.executeScript({
      type: 'script',
      statements: [{
        type: 'dropTable',
        name: { name: 'test_table' },
        ifExists: true
      }]
    });
  });

  it('executes transaction-wrapped script', async () => {
    const script: ScriptAST = {
      type: 'script',
      statements: [{
        type: 'tx',
        statements: [
          {
            type: 'createTable',
            name: { name: 'tx_test1' },
            columns: [{ name: 'id', type: 'int4', nullable: false }],
            ifNotExists: true
          },
          {
            type: 'createTable',
            name: { name: 'tx_test2' },
            columns: [{ name: 'id', type: 'int4', nullable: false }],
            ifNotExists: true
          }
        ]
      }]
    };

    const result = await admin.executeScript(script);
    
    expect(result.sql).toMatch(/^BEGIN;\n.*;\n.*;\nCOMMIT;$/s);
    
    // Clean up
    await admin.executeScript({
      type: 'script',
      statements: [
        { type: 'dropTable', name: { name: 'tx_test1' }, ifExists: true },
        { type: 'dropTable', name: { name: 'tx_test2' }, ifExists: true }
      ]
    });
  });

  it('handles advisory lock operations', async () => {
    let executed = false;
    
    await admin.withAdvisoryLock('test-lock', async () => {
      executed = true;
      return 'success';
    });
    
    expect(executed).toBe(true);
  });

  it('throws error on invalid DDL', async () => {
    const script: ScriptAST = {
      type: 'script',
      statements: [{
        type: 'createTable',
        name: { name: 'invalid_table' },
        columns: [
          { name: 'invalid_column', type: 'invalid_type' as any, nullable: false }
        ],
        ifNotExists: true
      }]
    };

    await expect(admin.executeScript(script)).rejects.toThrow();
  });
});
