import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { introspectPostgresSchema } from '@prisma-next/adapter-postgres/introspect';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { verifyDatabaseSchema } from '@prisma-next/core-control-plane/verify-database-schema';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { withClient, withDevDatabase } from '@prisma-next/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { SqlFamilyContext } from '../src/context';
import sqlFamilyDescriptor from '../src/control';
import { createSqlTypeMetadataRegistry } from '../src/type-metadata';

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
        return { rows: rows as Row[] } as { readonly rows: Row[] };
      },
    ) as ControlPlaneDriver['query'],
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
            id: { type: 'pg/int4@1', nullable: false },
            email: { type: 'pg/text@1', nullable: false },
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
  const adapterInstance = createPostgresAdapter();
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
      adapter: adapterInstance,
      introspect: introspectPostgresSchema,
    },
    extensions: [],
  };
}

/**
 * Creates a type metadata registry with adapter codecs.
 */
function createTestTypeMetadataRegistry() {
  const adapterInstance = createPostgresAdapter();
  const codecRegistry = adapterInstance.profile.codecs();
  return createSqlTypeMetadataRegistry([{ codecRegistry }]);
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

    const types = createTestTypeMetadataRegistry();
    const contextInput: SqlFamilyContext = { types };

    const result = await verifyDatabaseSchema<SqlFamilyContext>({
      driver,
      contractIR: contract,
      family: sqlFamilyDescriptor,
      target,
      adapter,
      extensions,
      contextInput,
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

    const types = createTestTypeMetadataRegistry();
    const contextInput: SqlFamilyContext = { types };

    const result = await verifyDatabaseSchema<SqlFamilyContext>({
      driver,
      contractIR: contract,
      family: sqlFamilyDescriptor,
      target,
      adapter,
      extensions,
      contextInput,
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

    const types = createTestTypeMetadataRegistry();
    const contextInput: SqlFamilyContext = { types };

    const result = await verifyDatabaseSchema<SqlFamilyContext>({
      driver,
      contractIR: contract,
      family: sqlFamilyDescriptor,
      target,
      adapter,
      extensions,
      contextInput,
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

    const types = createTestTypeMetadataRegistry();
    const contextInput: SqlFamilyContext = { types };

    const result = await verifyDatabaseSchema<SqlFamilyContext>({
      driver,
      contractIR: contract,
      family: sqlFamilyDescriptor,
      target,
      adapter,
      extensions,
      contextInput,
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
      expected: 'pg/int4@1',
      actual: 'pg/text@1', // varchar maps to text in PostgreSQL
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

    const types = createTestTypeMetadataRegistry();
    const contextInput: SqlFamilyContext = { types };

    const result = await verifyDatabaseSchema<SqlFamilyContext>({
      driver,
      contractIR: contract,
      family: sqlFamilyDescriptor,
      target,
      adapter,
      extensions,
      contextInput,
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

    const types = createTestTypeMetadataRegistry();
    const contextInput: SqlFamilyContext = { types };

    const result = await verifyDatabaseSchema<SqlFamilyContext>({
      driver,
      contractIR: contract,
      family: sqlFamilyDescriptor,
      target,
      adapter,
      extensions,
      contextInput,
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

    const types = createTestTypeMetadataRegistry();
    const contextInput: SqlFamilyContext = { types };

    const result = await verifyDatabaseSchema<SqlFamilyContext>({
      driver,
      contractIR: contract,
      family: sqlFamilyDescriptor,
      target,
      adapter,
      extensions,
      contextInput,
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

    const types = createTestTypeMetadataRegistry();
    const contextInput: SqlFamilyContext = { types };

    const result = await verifyDatabaseSchema<SqlFamilyContext>({
      driver,
      contractIR: contract,
      family: sqlFamilyDescriptor,
      target,
      adapter,
      extensions,
      contextInput,
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

    const types = createTestTypeMetadataRegistry();
    const contextInput: SqlFamilyContext = { types };

    const result = await verifyDatabaseSchema<SqlFamilyContext>({
      driver,
      contractIR: contract,
      family: sqlFamilyDescriptor,
      target,
      adapter,
      extensions,
      contextInput,
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

    // Create contextInput with types registry (codecRegistry is part of types)
    const adapterInstance = createPostgresAdapter();
    const codecRegistry = adapterInstance.profile.codecs();
    const types = createSqlTypeMetadataRegistry([{ codecRegistry }]);
    const contextInput: SqlFamilyContext = { types };

    const result = await verifyDatabaseSchema<SqlFamilyContext>({
      driver,
      contractIR: contract,
      family: sqlFamilyDescriptor,
      target,
      adapter,
      extensions,
      contextInput,
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

          // PostgreSQL automatically creates an index for primary keys
          const contract = createTestContract({
            storage: {
              tables: {
                user: {
                  columns: {
                    id: { type: 'pg/int4@1', nullable: false },
                    email: { type: 'pg/text@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [{ columns: ['email'] }],
                  indexes: [{ columns: ['id'] }], // Primary key index
                  foreignKeys: [],
                },
              },
            },
          });
          const { target, adapter, extensions } = createTestDescriptors();
          const startTime = Date.now();

          const driver: ControlPlaneDriver = {
            query: async <Row = Record<string, unknown>>(
              sql: string,
              params?: readonly unknown[],
            ) => {
              const result = await client.query(sql, params as unknown[] | undefined);
              return { rows: result.rows as Row[] } as { readonly rows: Row[] };
            },
            close: async () => {
              // Don't close the shared client
            },
          };

          const types = createTestTypeMetadataRegistry();
          const contextInput: SqlFamilyContext = { types };

          const result = await verifyDatabaseSchema<SqlFamilyContext>({
            driver,
            contractIR: contract,
            family: sqlFamilyDescriptor,
            target,
            adapter,
            extensions,
            contextInput,
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

describe('introspectSchema hook', () => {
  it('introspects schema with pre-assembled type metadata registry', async () => {
    const { target, adapter, extensions } = createTestDescriptors();
    const types = createTestTypeMetadataRegistry();
    const contextInput: SqlFamilyContext = { types };

    const queries = new Map<string, unknown[]>();
    queries.set('SELECT table_name', [{ table_name: 'user' }]);
    queries.set('SELECT extname', []);
    queries.set('SELECT column_name', [
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
    ]);
    queries.set('SELECT kcu.column_name', [{ column_name: 'id' }]);
    queries.set('SELECT kcu.column_name (FK)', []);
    queries.set('SELECT kcu.column_name, tc.constraint_name', [
      { column_name: 'email', constraint_name: 'user_email_key' },
    ]);
    queries.set('SELECT', []);

    const driver = createMockDriver(queries);

    const schemaIR = await sqlFamilyDescriptor.introspectSchema({
      driver,
      contextInput,
      target,
      adapter,
      extensions,
    });

    expect(schemaIR).toBeDefined();
    expect(schemaIR.tables).toBeDefined();
    expect(schemaIR.tables.user).toBeDefined();
    expect(schemaIR.tables.user.columns.id).toBeDefined();
    expect(schemaIR.tables.user.columns.id.typeId).toBe('pg/int4@1');
  });
});

describe('verifySchema hook', () => {
  it('verifies schema IR against contract IR', async () => {
    const contract = createTestContract();
    const { target, adapter, extensions } = createTestDescriptors();

    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: {
              name: 'id',
              typeId: 'pg/int4@1',
              nullable: false,
            },
            email: {
              name: 'email',
              typeId: 'pg/text@1',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['email'] }],
          indexes: [],
          foreignKeys: [],
        },
      },
      extensions: [],
    };

    const result = await sqlFamilyDescriptor.verifySchema({
      contractIR: contract,
      schemaIR,
      target,
      adapter,
      extensions,
    });

    expect(result.issues).toHaveLength(0);
  });

  it('detects missing table in schema IR', async () => {
    const contract = createTestContract();
    const { target, adapter, extensions } = createTestDescriptors();

    const schemaIR: SqlSchemaIR = {
      tables: {},
      extensions: [],
    };

    const result = await sqlFamilyDescriptor.verifySchema({
      contractIR: contract,
      schemaIR,
      target,
      adapter,
      extensions,
    });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toMatchObject({
      kind: 'missing_table',
      table: 'user',
    });
  });

  it('detects type mismatch', async () => {
    const contract = createTestContract();
    const { target, adapter, extensions } = createTestDescriptors();

    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: {
              name: 'id',
              typeId: 'pg/text@1', // Wrong type (should be pg/int4@1)
              nullable: false,
            },
            email: {
              name: 'email',
              typeId: 'pg/text@1',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      extensions: [],
    };

    const result = await sqlFamilyDescriptor.verifySchema({
      contractIR: contract,
      schemaIR,
      target,
      adapter,
      extensions,
    });

    expect(result.issues.length).toBeGreaterThan(0);
    const typeIssue = result.issues.find((i) => i.kind === 'type_mismatch' && i.column === 'id');
    expect(typeIssue).toBeDefined();
    expect(typeIssue).toMatchObject({
      kind: 'type_mismatch',
      table: 'user',
      column: 'id',
      expected: 'pg/int4@1',
      actual: 'pg/text@1', // Note: schemaIR uses pg/text@1, not pg/varchar@1
    });
  });
});
