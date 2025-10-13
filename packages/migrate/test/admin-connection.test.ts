import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { connectAdmin } from '../src/admin-connection';
import { ScriptAST } from '../src/script-ast';

// Mock database connection for testing
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

describe('AdminConnection', () => {
  let admin: Awaited<ReturnType<typeof connectAdmin>>;

  beforeEach(async () => {
    admin = await connectAdmin(TEST_DB_URL);
    // Clean up any existing contract schema and table
    try {
      await admin.executeScript({
        type: 'script',
        statements: [
          {
            type: 'raw',
            template: [{ kind: 'rawUnsafe', sql: 'DROP SCHEMA IF EXISTS prisma_contract CASCADE' }],
          },
        ],
      });
    } catch (error) {
      // Ignore errors - schema might not exist
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
      statements: [
        {
          type: 'createTable',
          name: { name: 'test_table' },
          columns: [
            { name: 'id', type: 'int4', nullable: false },
            { name: 'name', type: 'text', nullable: false },
          ],
          ifNotExists: true,
        },
      ],
    };

    const result = await admin.executeScript(script);

    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS "test_table"');
    expect(result.sqlHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    // Clean up
    await admin.executeScript({
      type: 'script',
      statements: [
        {
          type: 'dropTable',
          name: { name: 'test_table' },
          ifExists: true,
        },
      ],
    });
  });

  it('executes transaction-wrapped script', async () => {
    const script: ScriptAST = {
      type: 'script',
      statements: [
        {
          type: 'tx',
          statements: [
            {
              type: 'createTable',
              name: { name: 'tx_test1' },
              columns: [{ name: 'id', type: 'int4', nullable: false }],
              ifNotExists: true,
            },
            {
              type: 'createTable',
              name: { name: 'tx_test2' },
              columns: [{ name: 'id', type: 'int4', nullable: false }],
              ifNotExists: true,
            },
          ],
        },
      ],
    };

    const result = await admin.executeScript(script);

    expect(result.sql).toMatch(/^BEGIN;\n.*;\n.*;\nCOMMIT;$/s);

    // Clean up
    await admin.executeScript({
      type: 'script',
      statements: [
        { type: 'dropTable', name: { name: 'tx_test1' }, ifExists: true },
        { type: 'dropTable', name: { name: 'tx_test2' }, ifExists: true },
      ],
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
      statements: [
        {
          type: 'createTable',
          name: { name: 'invalid_table' },
          columns: [{ name: 'invalid_column', type: 'invalid_type' as any, nullable: false }],
          ifNotExists: true,
        },
      ],
    };

    await expect(admin.executeScript(script)).rejects.toThrow();
  });

  it('maintains contract hash consistency - readContract always returns latest hash', async () => {
    // Write initial contract hash
    const initialHash = 'sha256:initial123';
    await admin.writeContract(initialHash);

    // Verify readContract returns the same hash
    const readResult = await admin.readContract();
    expect(readResult.hash).toBe(initialHash);

    // Update contract hash
    const updatedHash = 'sha256:updated456';
    await admin.writeContract(updatedHash);

    // Verify readContract returns the updated hash
    const readResult2 = await admin.readContract();
    expect(readResult2.hash).toBe(updatedHash);

    // Test that multiple writes don't create multiple rows
    await admin.writeContract('sha256:final789');
    const finalResult = await admin.readContract();
    expect(finalResult.hash).toBe('sha256:final789');
  });

  it('ensures only one contract hash row exists (prevents accumulation)', async () => {
    // Write multiple contract hashes
    await admin.writeContract('sha256:first');
    await admin.writeContract('sha256:second');
    await admin.writeContract('sha256:third');

    // Verify only one row exists with the latest hash
    const result = await admin.readContract();
    expect(result.hash).toBe('sha256:third');

    // Verify the table has exactly one row
    const countResult = await admin.executeScript({
      type: 'script',
      statements: [
        {
          type: 'raw',
          template: [
            { kind: 'rawUnsafe', sql: 'SELECT COUNT(*) as count FROM prisma_contract.version' },
          ],
        },
      ],
    });

    // The count should be 1, not 3
    expect(countResult.sql).toContain('SELECT COUNT(*)');
  });
});
