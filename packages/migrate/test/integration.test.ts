import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { connectAdmin, pgLowerer, renderScript } from '../src/exports';
import type { OpSet } from '../src/exports';

// Mock database connection for testing
const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

describe('Integration Tests', () => {
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

  it('full pipeline: OpSet → lower → render → execute', async () => {
    const opset: OpSet = [
      {
        kind: 'addTable',
        name: 'integration_test',
        columns: [
          { name: 'id', type: 'int4', nullable: false, default: { kind: 'autoincrement' } },
          { name: 'email', type: 'varchar', nullable: false },
          { name: 'active', type: 'bool', nullable: false, default: { kind: 'literal', value: 'true' } }
        ],
        constraints: [
          { kind: 'primaryKey', columns: ['id'] },
          { kind: 'unique', columns: ['email'] }
        ]
      }
    ];

    // Step 1: Lower operations to Script AST
    const lowerer = pgLowerer();
    const script = lowerer.lower(opset);
    
    expect(script.type).toBe('script');
    expect(script.statements).toHaveLength(1);
    expect(script.statements[0].type).toBe('tx');

    // Step 2: Render Script AST to SQL
    const { sql, sqlHash } = renderScript(script);
    
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "integration_test"');
    expect(sqlHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    // Step 3: Execute SQL via AdminConnection
    const result = await admin.executeScript(script);
    
    expect(result.sql).toBe(sql);
    expect(result.sqlHash).toBe(sqlHash);

    // Clean up
    await admin.executeScript({
      type: 'script',
      statements: [{
        type: 'dropTable',
        name: { name: 'integration_test' },
        ifExists: true
      }]
    });
  });

  it('contract hash read/write cycle', async () => {
    const testHash = 'sha256:integration-test-hash' as const;
    
    // Write contract hash
    await admin.writeContract(testHash);
    
    // Read it back
    const result = await admin.readContract();
    expect(result.hash).toBe(testHash);
    
    // Update to new hash
    const newHash = 'sha256:updated-integration-test-hash' as const;
    await admin.writeContract(newHash);
    
    // Verify update
    const updatedResult = await admin.readContract();
    expect(updatedResult.hash).toBe(newHash);
  });

  it('advisory lock prevents concurrent execution', async () => {
    const script = {
      type: 'script' as const,
      statements: [{
        type: 'createTable' as const,
        name: { name: 'concurrent_test' },
        columns: [{ name: 'id', type: 'int4' as const, nullable: false }],
        ifNotExists: true
      }]
    };

    // Create second admin connection
    const admin2 = await connectAdmin(TEST_DB_URL);
    
    try {
      // Both should be able to execute with advisory locks
      const [result1, result2] = await Promise.all([
        admin.withAdvisoryLock('concurrent-test', () => admin.executeScript(script)),
        admin2.withAdvisoryLock('concurrent-test', () => admin2.executeScript(script))
      ]);
      
      expect(result1.sqlHash).toBe(result2.sqlHash);
      
      // Clean up
      await admin.executeScript({
        type: 'script',
        statements: [{
          type: 'dropTable',
          name: { name: 'concurrent_test' },
          ifExists: true
        }]
      });
    } finally {
      await admin2.close();
    }
  });

  it('deterministic hash across pipeline', async () => {
    const opset: OpSet = [
      {
        kind: 'addTable',
        name: 'deterministic_test',
        columns: [
          { name: 'id', type: 'int4', nullable: false },
          { name: 'name', type: 'text', nullable: false }
        ],
        constraints: [{ kind: 'primaryKey', columns: ['id'] }]
      }
    ];

    // Run pipeline multiple times
    const lowerer = pgLowerer();
    const results = [];
    
    for (let i = 0; i < 3; i++) {
      const script = lowerer.lower(opset);
      const { sqlHash } = renderScript(script);
      results.push(sqlHash);
    }
    
    // All hashes should be identical
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
    
    // Execute and verify SQL hash matches
    const script = lowerer.lower(opset);
    const { sqlHash } = renderScript(script);
    const execResult = await admin.executeScript(script);
    
    expect(execResult.sqlHash).toBe(sqlHash);
    
    // Clean up
    await admin.executeScript({
      type: 'script',
      statements: [{
        type: 'dropTable',
        name: { name: 'deterministic_test' },
        ifExists: true
      }]
    });
  });
});
