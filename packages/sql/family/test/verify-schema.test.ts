import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { withClient, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it, vi } from 'vitest';
import sqlFamilyDescriptor from '../src/exports/cli';

/**
 * Creates a mock driver for testing.
 */
function createMockDriver(queries: Map<string, unknown[]>): ControlPlaneDriver {
  return {
    query: vi.fn(
      async <Row = Record<string, unknown>>(sql: string, _params?: readonly unknown[]) => {
        // Normalize SQL for matching (remove extra whitespace, convert to single line)
        const normalized = sql.trim().replace(/\s+/g, ' ').toLowerCase();

        // Try to match by unique query patterns
        let key: string | undefined;
        if (normalized.includes('information_schema.tables') && normalized.includes('table_name')) {
          key = 'SELECT table_name';
        } else if (
          normalized.includes('information_schema.columns') &&
          normalized.includes('column_name')
        ) {
          key = 'SELECT column_name';
        } else if (normalized.includes('primary key') && normalized.includes('kcu.column_name')) {
          key = 'SELECT kcu.column_name';
        } else if (normalized.includes('foreign key') && normalized.includes('kcu.column_name')) {
          key = 'SELECT kcu.column_name (FK)';
        } else if (normalized.includes('unique') && normalized.includes('kcu.column_name')) {
          key = 'SELECT kcu.column_name, tc.constraint_name';
        } else if (normalized.includes('pg_index') && normalized.includes('pg_class')) {
          key = 'SELECT';
        } else if (normalized.includes('pg_extension') && normalized.includes('extname')) {
          key = 'SELECT extname';
        } else {
          // Fallback to first line
          key = sql.trim().split('\n')[0].trim();
        }

        const rows = queries.get(key) ?? [];
        return { rows: rows as Row[] };
      },
    ),
    close: vi.fn(async () => {}),
  };
}

/**
 * Creates a minimal test contract.
 */
function createTestContract(overrides?: Partial<SqlContract<SqlStorage>>): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    models: {},
    relations: {},
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'int4', nullable: false },
            email: { type: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['email'] }],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    mappings: {},
    ...overrides,
  } as SqlContract<SqlStorage>;
}

/**
 * Creates test descriptors.
 */
function createTestDescriptors(): {
  target: TargetDescriptor;
  adapter: AdapterDescriptor;
  extensions: ReadonlyArray<ExtensionDescriptor>;
} {
  return {
    target: {
      kind: 'target',
      id: 'postgres',
      family: 'sql',
      manifest: { id: 'postgres', version: '15.0.0' },
    },
    adapter: {
      kind: 'adapter',
      id: 'postgres',
      family: 'sql',
      manifest: { id: 'postgres', version: '15.0.0' },
    },
    extensions: [],
  };
}

describe('verifySchema', () => {
  it('returns ok when schema matches contract', async () => {
    const contract = createTestContract();
    const { target, adapter, extensions } = createTestDescriptors();
    const startTime = Date.now();

    const queries = new Map<string, unknown[]>();
    queries.set('SELECT table_name', [{ table_name: 'user' }]);
    queries.set('SELECT extname', []);
    queries.set('SELECT column_name', [
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
    ]);
    queries.set('SELECT kcu.column_name', [{ column_name: 'id' }]);
    queries.set('SELECT kcu.column_name (FK)', []); // foreign keys
    queries.set('SELECT kcu.column_name, tc.constraint_name', [
      { column_name: 'email', constraint_name: 'user_email_key' },
    ]);
    queries.set('SELECT', []); // indexes query

    const driver = createMockDriver(queries);

    const result = await sqlFamilyDescriptor.verify.verifySchema!({
      driver,
      contractIR: contract,
      target,
      adapter,
      extensions,
      strict: false,
      startTime,
      contractPath: 'contract.json',
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Database schema matches contract');
    expect(result.schema.issues).toHaveLength(0);
  });

  it('detects missing table', async () => {
    const contract = createTestContract();
    const { target, adapter, extensions } = createTestDescriptors();
    const startTime = Date.now();

    const queries = new Map<string, unknown[]>();
    queries.set('SELECT table_name', []); // No tables
    queries.set('SELECT extname', []);

    const driver = createMockDriver(queries);

    const result = await sqlFamilyDescriptor.verify.verifySchema!({
      driver,
      contractIR: contract,
      target,
      adapter,
      extensions,
      strict: false,
      startTime,
      contractPath: 'contract.json',
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('PN-SCHEMA-0001');
    expect(result.schema.issues).toHaveLength(1);
    expect(result.schema.issues[0]).toMatchObject({
      kind: 'missing_table',
      table: 'user',
      message: expect.stringContaining('Table user is not present'),
    });
  });

  it('detects missing column', async () => {
    const contract = createTestContract();
    const { target, adapter, extensions } = createTestDescriptors();
    const startTime = Date.now();

    const queries = new Map<string, unknown[]>();
    queries.set('SELECT table_name', [{ table_name: 'user' }]);
    queries.set('SELECT extname', []);
    queries.set('SELECT column_name', [
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
      // Missing email column
    ]);
    queries.set('SELECT kcu.column_name', [{ column_name: 'id' }]);
    queries.set('SELECT kcu.column_name (FK)', []); // foreign keys
    queries.set('SELECT kcu.column_name, tc.constraint_name', []);
    queries.set('SELECT', []); // indexes query

    const driver = createMockDriver(queries);

    const result = await sqlFamilyDescriptor.verify.verifySchema!({
      driver,
      contractIR: contract,
      target,
      adapter,
      extensions,
      strict: false,
      startTime,
      contractPath: 'contract.json',
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues.length).toBeGreaterThanOrEqual(1);
    const missingColumnIssue = result.schema.issues.find(
      (i) => i.kind === 'missing_column' && i.column === 'email',
    );
    expect(missingColumnIssue).toBeDefined();
    expect(missingColumnIssue).toMatchObject({
      kind: 'missing_column',
      table: 'user',
      column: 'email',
    });
  });

  it('detects type mismatch', async () => {
    const contract = createTestContract();
    const { target, adapter, extensions } = createTestDescriptors();
    const startTime = Date.now();

    const queries = new Map<string, unknown[]>();
    queries.set('SELECT table_name', [{ table_name: 'user' }]);
    queries.set('SELECT extname', []);
    queries.set('SELECT column_name', [
      { column_name: 'id', data_type: 'varchar', is_nullable: 'NO' }, // Wrong type
      { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
    ]);
    queries.set('SELECT kcu.column_name', [{ column_name: 'id' }]);
    queries.set('SELECT kcu.column_name (FK)', []); // foreign keys
    queries.set('SELECT kcu.column_name, tc.constraint_name', [
      { column_name: 'email', constraint_name: 'user_email_key' },
    ]);
    queries.set('SELECT', []); // indexes query

    const driver = createMockDriver(queries);

    const result = await sqlFamilyDescriptor.verify.verifySchema!({
      driver,
      contractIR: contract,
      target,
      adapter,
      extensions,
      strict: false,
      startTime,
      contractPath: 'contract.json',
    });

    expect(result.ok).toBe(false);
    const typeIssue = result.schema.issues.find((i) => i.kind === 'type_mismatch');
    expect(typeIssue).toBeDefined();
    expect(typeIssue).toMatchObject({
      kind: 'type_mismatch',
      table: 'user',
      column: 'id',
      expected: 'int4',
      actual: 'varchar',
    });
  });

  it('detects nullability mismatch', async () => {
    const contract = createTestContract();
    const { target, adapter, extensions } = createTestDescriptors();
    const startTime = Date.now();

    const queries = new Map<string, unknown[]>();
    queries.set('SELECT table_name', [{ table_name: 'user' }]);
    queries.set('SELECT extname', []);
    queries.set('SELECT column_name', [
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'email', data_type: 'text', is_nullable: 'YES' }, // Should be NOT NULL
    ]);
    queries.set('SELECT kcu.column_name', [{ column_name: 'id' }]);
    queries.set('SELECT kcu.column_name (FK)', []); // foreign keys
    queries.set('SELECT kcu.column_name, tc.constraint_name', [
      { column_name: 'email', constraint_name: 'user_email_key' },
    ]);
    queries.set('SELECT', []); // indexes query

    const driver = createMockDriver(queries);

    const result = await sqlFamilyDescriptor.verify.verifySchema!({
      driver,
      contractIR: contract,
      target,
      adapter,
      extensions,
      strict: false,
      startTime,
      contractPath: 'contract.json',
    });

    expect(result.ok).toBe(false);
    const nullabilityIssue = result.schema.issues.find((i) => i.kind === 'nullability_mismatch');
    expect(nullabilityIssue).toBeDefined();
    expect(nullabilityIssue).toMatchObject({
      kind: 'nullability_mismatch',
      table: 'user',
      column: 'email',
    });
  });

  it('detects primary key mismatch', async () => {
    const contract = createTestContract();
    const { target, adapter, extensions } = createTestDescriptors();
    const startTime = Date.now();

    const queries = new Map<string, unknown[]>();
    queries.set('SELECT table_name', [{ table_name: 'user' }]);
    queries.set('SELECT extname', []);
    queries.set('SELECT column_name', [
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
    ]);
    queries.set('SELECT kcu.column_name', [{ column_name: 'email' }]); // Wrong PK
    queries.set('SELECT kcu.column_name (FK)', []); // foreign keys
    queries.set('SELECT kcu.column_name, tc.constraint_name', [
      { column_name: 'email', constraint_name: 'user_email_key' },
    ]);
    queries.set('SELECT', []); // indexes query

    const driver = createMockDriver(queries);

    const result = await sqlFamilyDescriptor.verify.verifySchema!({
      driver,
      contractIR: contract,
      target,
      adapter,
      extensions,
      strict: false,
      startTime,
      contractPath: 'contract.json',
    });

    expect(result.ok).toBe(false);
    const pkIssue = result.schema.issues.find((i) => i.kind === 'primary_key_mismatch');
    expect(pkIssue).toBeDefined();
    expect(pkIssue).toMatchObject({
      kind: 'primary_key_mismatch',
      table: 'user',
    });
  });

  it('accepts compatible types (int4 = integer)', async () => {
    const contract = createTestContract();
    const { target, adapter, extensions } = createTestDescriptors();
    const startTime = Date.now();

    const queries = new Map<string, unknown[]>();
    queries.set('SELECT table_name', [{ table_name: 'user' }]);
    queries.set('SELECT extname', []);
    queries.set('SELECT column_name', [
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO' }, // integer is compatible with int4
      { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
    ]);
    queries.set('SELECT kcu.column_name', [{ column_name: 'id' }]);
    queries.set('SELECT kcu.column_name (FK)', []); // foreign keys
    queries.set('SELECT kcu.column_name, tc.constraint_name', [
      { column_name: 'email', constraint_name: 'user_email_key' },
    ]);
    queries.set('SELECT', []); // indexes query

    const driver = createMockDriver(queries);

    const result = await sqlFamilyDescriptor.verify.verifySchema!({
      driver,
      contractIR: contract,
      target,
      adapter,
      extensions,
      strict: false,
      startTime,
      contractPath: 'contract.json',
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('includes timings in result', async () => {
    const contract = createTestContract();
    const { target, adapter, extensions } = createTestDescriptors();
    const startTime = Date.now();

    const queries = new Map<string, unknown[]>();
    queries.set('SELECT table_name', [{ table_name: 'user' }]);
    queries.set('SELECT extname', []);
    queries.set('SELECT column_name', [
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
    ]);
    queries.set('SELECT kcu.column_name', [{ column_name: 'id' }]);
    queries.set('SELECT kcu.column_name (FK)', []); // foreign keys
    queries.set('SELECT kcu.column_name, tc.constraint_name', [
      { column_name: 'email', constraint_name: 'user_email_key' },
    ]);
    queries.set('SELECT', []); // indexes query

    const driver = createMockDriver(queries);

    const result = await sqlFamilyDescriptor.verify.verifySchema!({
      driver,
      contractIR: contract,
      target,
      adapter,
      extensions,
      strict: false,
      startTime,
      contractPath: 'contract.json',
    });

    expect(result.timings.total).toBeGreaterThanOrEqual(0);
  });

  it('includes contract hashes in result', async () => {
    const contract = createTestContract({ profileHash: 'sha256:profile' });
    const { target, adapter, extensions } = createTestDescriptors();
    const startTime = Date.now();

    const queries = new Map<string, unknown[]>();
    queries.set('SELECT table_name', [{ table_name: 'user' }]);
    queries.set('SELECT extname', []);
    queries.set('SELECT column_name', [
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
    ]);
    queries.set('SELECT kcu.column_name', [{ column_name: 'id' }]);
    queries.set('SELECT kcu.column_name (FK)', []); // foreign keys
    queries.set('SELECT kcu.column_name, tc.constraint_name', [
      { column_name: 'email', constraint_name: 'user_email_key' },
    ]);
    queries.set('SELECT', []); // indexes query

    const driver = createMockDriver(queries);

    const result = await sqlFamilyDescriptor.verify.verifySchema!({
      driver,
      contractIR: contract,
      target,
      adapter,
      extensions,
      strict: false,
      startTime,
      contractPath: 'contract.json',
    });

    expect(result.contract.coreHash).toBe('sha256:test');
    expect(result.contract.profileHash).toBe('sha256:profile');
  });

  it('includes meta in result', async () => {
    const contract = createTestContract();
    const { target, adapter, extensions } = createTestDescriptors();
    const startTime = Date.now();

    const queries = new Map<string, unknown[]>();
    queries.set('SELECT table_name', [{ table_name: 'user' }]);
    queries.set('SELECT extname', []);
    queries.set('SELECT column_name', [
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
    ]);
    queries.set('SELECT kcu.column_name', [{ column_name: 'id' }]);
    queries.set('SELECT kcu.column_name (FK)', []); // foreign keys
    queries.set('SELECT kcu.column_name, tc.constraint_name', [
      { column_name: 'email', constraint_name: 'user_email_key' },
    ]);
    queries.set('SELECT', []); // indexes query

    const driver = createMockDriver(queries);

    const result = await sqlFamilyDescriptor.verify.verifySchema!({
      driver,
      contractIR: contract,
      target,
      adapter,
      extensions,
      strict: true,
      startTime,
      contractPath: 'contract.json',
      configPath: 'config.ts',
    });

    expect(result.meta).toBeDefined();
    expect(result.meta?.contractPath).toBe('contract.json');
    expect(result.meta?.configPath).toBe('config.ts');
    expect(result.meta?.strict).toBe(true);
  });
});

describe('verifySchema integration', () => {
  it('verifies schema against real database', async () => {
    await withDevDatabase(
      async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          // Create test table
          await client.query(`
              CREATE TABLE "user" (
                "id" INTEGER NOT NULL,
                "email" TEXT NOT NULL,
                PRIMARY KEY ("id"),
                UNIQUE ("email")
              )
            `);

          const contract = createTestContract();
          const { target, adapter, extensions } = createTestDescriptors();
          const startTime = Date.now();

          const driver: ControlPlaneDriver = {
            query: async <Row = Record<string, unknown>>(
              sql: string,
              params?: readonly unknown[],
            ) => {
              const result = await client.query(sql, params as unknown[] | undefined);
              return { rows: result.rows as Row[] };
            },
            close: async () => {
              // Don't close the shared client
            },
          };

          const result = await sqlFamilyDescriptor.verify.verifySchema!({
            driver,
            contractIR: contract,
            target,
            adapter,
            extensions,
            strict: false,
            startTime,
            contractPath: 'contract.json',
          });

          expect(result.ok).toBe(true);
          expect(result.schema.issues).toHaveLength(0);

          // Cleanup
          await client.query('DROP TABLE IF EXISTS "user"');
        });
      },
      { acceleratePort: 54190, databasePort: 54191, shadowDatabasePort: 54192 },
    );
  }, 30000);
});
