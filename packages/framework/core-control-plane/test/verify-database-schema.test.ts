import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { verifyDatabaseSchema } from '../src/actions/verify-database-schema';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from '../src/types';

/**
 * Creates a mock ControlPlaneDriver for testing.
 */
function createMockDriver(responses: Array<{ sql: string; rows: unknown[] }>): ControlPlaneDriver {
  let callIndex = 0;
  return {
    async query<Row = Record<string, unknown>>(
      sql: string,
      _params?: readonly unknown[],
    ): Promise<{ readonly rows: Row[] }> {
      const response = responses[callIndex];
      if (!response) {
        throw new Error(`Unexpected query call ${callIndex}: ${sql}`);
      }
      callIndex++;
      return { rows: response.rows as Row[] };
    },
    async close(): Promise<void> {
      // No-op
    },
  };
}

/**
 * Creates a mock family descriptor with introspectSchema hook.
 */
function createMockFamily(
  introspectSchemaImpl: (options: {
    readonly driver: ControlPlaneDriver;
    readonly contextInput: unknown;
    readonly contractIR?: unknown;
    readonly target: TargetDescriptor;
    readonly adapter: AdapterDescriptor;
    readonly extensions: ReadonlyArray<ExtensionDescriptor>;
  }) => Promise<SqlSchemaIR>,
  verifySchemaImpl?: (options: {
    readonly contractIR: unknown;
    readonly schemaIR: SqlSchemaIR;
    readonly target: TargetDescriptor;
    readonly adapter: AdapterDescriptor;
    readonly extensions: ReadonlyArray<ExtensionDescriptor>;
  }) => Promise<{ readonly issues: readonly unknown[] }>,
): FamilyDescriptor<{ schemaIR: SqlSchemaIR }> {
  return {
    kind: 'family',
    id: 'sql',
    hook: {} as never,
    readMarker: async () => null,
    prepareControlContext: async () => ({}),
    introspectSchema: introspectSchemaImpl,
    verifySchema:
      verifySchemaImpl ??
      (async () => ({
        issues: [],
      })),
    convertOperationManifest: () => {
      throw new Error('Not implemented');
    },
    validateContractIR: (contract) => contract,
  };
}

/**
 * Creates a minimal test contract.
 */
function createTestContract() {
  return {
    target: 'postgres',
    targetFamily: 'sql' as const,
    coreHash: 'sha256:test-core',
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            email: { type: 'pg/text@1', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {},
  };
}

describe('verifyDatabaseSchema', () => {
  it('returns ok when schema matches contract', async () => {
    const contract = {
      ...createTestContract(),
      storage: {
        tables: {
          user: {
            ...createTestContract().storage.tables.user,
            primaryKey: { columns: ['id'] }, // Contract has primaryKey as object
          },
        },
      },
    };
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: {
              name: 'id',
              typeId: 'pg/int4@1',
              nativeType: 'integer',
              nullable: false,
            },
            email: {
              name: 'email',
              typeId: 'pg/text@1',
              nativeType: 'text',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] }, // SchemaIR now matches ContractIR format
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      extensions: [],
    };

    const family = createMockFamily(async () => schemaIR);
    const target: TargetDescriptor = {
      kind: 'target',
      id: 'postgres',
      family: 'sql',
      manifest: {} as never,
    };
    const adapter: AdapterDescriptor = {
      kind: 'adapter',
      id: 'postgres',
      family: 'sql',
      manifest: {} as never,
    };

    const driver = createMockDriver([]);
    const result = await verifyDatabaseSchema({
      driver,
      contractIR: contract,
      family,
      target,
      adapter,
      extensions: [],
      contextInput: {},
      strict: false,
      startTime: Date.now(),
      contractPath: 'test/contract.json',
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('reports missing table issue', async () => {
    const contract = createTestContract();
    const schemaIR: SqlSchemaIR = {
      tables: {},
      extensions: [],
    };

    const family = createMockFamily(
      async () => schemaIR,
      async ({ contractIR, schemaIR: schema }) => {
        const issues: unknown[] = [];
        if (
          typeof contractIR === 'object' &&
          contractIR !== null &&
          'storage' in contractIR &&
          typeof contractIR.storage === 'object' &&
          contractIR.storage !== null &&
          'tables' in contractIR.storage &&
          typeof contractIR.storage.tables === 'object' &&
          contractIR.storage.tables !== null
        ) {
          const contractTables = contractIR.storage.tables as Record<string, unknown>;
          if (
            typeof schema === 'object' &&
            schema !== null &&
            'tables' in schema &&
            typeof schema.tables === 'object' &&
            schema.tables !== null
          ) {
            const schemaTables = schema.tables as Record<string, unknown>;
            for (const [tableName] of Object.entries(contractTables)) {
              if (!schemaTables[tableName]) {
                issues.push({
                  kind: 'missing_table',
                  table: tableName,
                  message: `Table ${tableName} is not present in database`,
                });
              }
            }
          }
        }
        return { issues };
      },
    );
    const target: TargetDescriptor = {
      kind: 'target',
      id: 'postgres',
      family: 'sql',
      manifest: {} as never,
    };
    const adapter: AdapterDescriptor = {
      kind: 'adapter',
      id: 'postgres',
      family: 'sql',
      manifest: {} as never,
    };

    const driver = createMockDriver([]);
    const result = await verifyDatabaseSchema({
      driver,
      contractIR: contract,
      family,
      target,
      adapter,
      extensions: [],
      contextInput: {},
      strict: false,
      startTime: Date.now(),
      contractPath: 'test/contract.json',
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toHaveLength(1);
    expect(result.schema.issues[0]?.kind).toBe('missing_table');
    expect(result.schema.issues[0]?.table).toBe('user');
  });

  it('reports missing column issue', async () => {
    const contract = createTestContract();
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: {
              name: 'id',
              typeId: 'pg/int4@1',
              nativeType: 'integer',
              nullable: false,
            },
            // email column is missing
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      extensions: [],
    };

    const family = createMockFamily(
      async () => schemaIR,
      async ({ contractIR, schemaIR: schema }) => {
        const issues: unknown[] = [];
        if (
          typeof contractIR === 'object' &&
          contractIR !== null &&
          'storage' in contractIR &&
          typeof contractIR.storage === 'object' &&
          contractIR.storage !== null &&
          'tables' in contractIR.storage &&
          typeof contractIR.storage.tables === 'object' &&
          contractIR.storage.tables !== null
        ) {
          const contractTables = contractIR.storage.tables as Record<string, unknown>;
          if (
            typeof schema === 'object' &&
            schema !== null &&
            'tables' in schema &&
            typeof schema.tables === 'object' &&
            schema.tables !== null
          ) {
            const schemaTables = schema.tables as Record<string, unknown>;
            for (const [tableName, contractTable] of Object.entries(contractTables)) {
              const schemaTable = schemaTables[tableName];
              if (
                typeof contractTable === 'object' &&
                contractTable !== null &&
                'columns' in contractTable &&
                typeof contractTable.columns === 'object' &&
                contractTable.columns !== null &&
                typeof schemaTable === 'object' &&
                schemaTable !== null &&
                'columns' in schemaTable &&
                typeof schemaTable.columns === 'object' &&
                schemaTable.columns !== null
              ) {
                const contractColumns = contractTable.columns as Record<string, unknown>;
                const schemaColumns = schemaTable.columns as Record<string, unknown>;
                for (const [columnName] of Object.entries(contractColumns)) {
                  if (!schemaColumns[columnName]) {
                    issues.push({
                      kind: 'missing_column',
                      table: tableName,
                      column: columnName,
                      message: `Column ${tableName}.${columnName} is not present in database`,
                    });
                  }
                }
              }
            }
          }
        }
        return { issues };
      },
    );
    const target: TargetDescriptor = {
      kind: 'target',
      id: 'postgres',
      family: 'sql',
      manifest: {} as never,
    };
    const adapter: AdapterDescriptor = {
      kind: 'adapter',
      id: 'postgres',
      family: 'sql',
      manifest: {} as never,
    };

    const driver = createMockDriver([]);
    const result = await verifyDatabaseSchema({
      driver,
      contractIR: contract,
      family,
      target,
      adapter,
      extensions: [],
      contextInput: {},
      strict: false,
      startTime: Date.now(),
      contractPath: 'test/contract.json',
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toHaveLength(1);
    expect(result.schema.issues[0]?.kind).toBe('missing_column');
    expect(result.schema.issues[0]?.table).toBe('user');
    expect(result.schema.issues[0]?.column).toBe('email');
  });

  it('reports type mismatch issue', async () => {
    const contract = createTestContract();
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: {
              name: 'id',
              typeId: 'pg/text@1', // Wrong type - should be pg/int4@1
              nativeType: 'text',
              nullable: false,
            },
            email: {
              name: 'email',
              typeId: 'pg/text@1',
              nativeType: 'text',
              nullable: false,
            },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      extensions: [],
    };

    const family = createMockFamily(
      async () => schemaIR,
      async ({ contractIR, schemaIR: schema }) => {
        const issues: unknown[] = [];
        if (
          typeof contractIR === 'object' &&
          contractIR !== null &&
          'storage' in contractIR &&
          typeof contractIR.storage === 'object' &&
          contractIR.storage !== null &&
          'tables' in contractIR.storage &&
          typeof contractIR.storage.tables === 'object' &&
          contractIR.storage.tables !== null
        ) {
          const contractTables = contractIR.storage.tables as Record<string, unknown>;
          if (
            typeof schema === 'object' &&
            schema !== null &&
            'tables' in schema &&
            typeof schema.tables === 'object' &&
            schema.tables !== null
          ) {
            const schemaTables = schema.tables as Record<string, unknown>;
            for (const [tableName, contractTable] of Object.entries(contractTables)) {
              const schemaTable = schemaTables[tableName];
              if (
                typeof contractTable === 'object' &&
                contractTable !== null &&
                'columns' in contractTable &&
                typeof contractTable.columns === 'object' &&
                contractTable.columns !== null &&
                typeof schemaTable === 'object' &&
                schemaTable !== null &&
                'columns' in schemaTable &&
                typeof schemaTable.columns === 'object' &&
                schemaTable.columns !== null
              ) {
                const contractColumns = contractTable.columns as Record<string, unknown>;
                const schemaColumns = schemaTable.columns as Record<string, unknown>;
                for (const [columnName, contractColumn] of Object.entries(contractColumns)) {
                  const schemaColumn = schemaColumns[columnName];
                  if (
                    typeof contractColumn === 'object' &&
                    contractColumn !== null &&
                    'type' in contractColumn &&
                    typeof contractColumn.type === 'string' &&
                    typeof schemaColumn === 'object' &&
                    schemaColumn !== null &&
                    'typeId' in schemaColumn &&
                    typeof schemaColumn.typeId === 'string'
                  ) {
                    if (contractColumn.type !== schemaColumn.typeId) {
                      issues.push({
                        kind: 'type_mismatch',
                        table: tableName,
                        column: columnName,
                        expected: contractColumn.type,
                        actual: schemaColumn.typeId,
                        message: `Column ${tableName}.${columnName} type mismatch: expected ${contractColumn.type}, found ${schemaColumn.typeId}`,
                      });
                    }
                  }
                }
              }
            }
          }
        }
        return { issues };
      },
    );
    const target: TargetDescriptor = {
      kind: 'target',
      id: 'postgres',
      family: 'sql',
      manifest: {} as never,
    };
    const adapter: AdapterDescriptor = {
      kind: 'adapter',
      id: 'postgres',
      family: 'sql',
      manifest: {} as never,
    };

    const driver = createMockDriver([]);
    const result = await verifyDatabaseSchema({
      driver,
      contractIR: contract,
      family,
      target,
      adapter,
      extensions: [],
      contextInput: {},
      strict: false,
      startTime: Date.now(),
      contractPath: 'test/contract.json',
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues.some((issue) => issue.kind === 'type_mismatch')).toBe(true);
  });

  it('calls extension verifySchema hooks and aggregates issues', async () => {
    const contract = createTestContract();
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: {
              name: 'id',
              typeId: 'pg/int4@1',
              nativeType: 'integer',
              nullable: false,
            },
            email: {
              name: 'email',
              typeId: 'pg/text@1',
              nativeType: 'text',
              nullable: false,
            },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      extensions: [],
    };

    const extensionIssue = {
      kind: 'extension_missing',
      message: 'pgvector extension is not installed',
      table: 'user',
      column: 'vector_col',
    };

    const extension: ExtensionDescriptor = {
      kind: 'extension',
      id: 'pgvector',
      family: 'sql',
      manifest: {} as never,
      verifySchema: async () => [extensionIssue],
    };

    const family = createMockFamily(async () => schemaIR);
    const target: TargetDescriptor = {
      kind: 'target',
      id: 'postgres',
      family: 'sql',
      manifest: {} as never,
    };
    const adapter: AdapterDescriptor = {
      kind: 'adapter',
      id: 'postgres',
      family: 'sql',
      manifest: {} as never,
    };

    const driver = createMockDriver([]);
    const result = await verifyDatabaseSchema({
      driver,
      contractIR: contract,
      family,
      target,
      adapter,
      extensions: [extension],
      strict: false,
      startTime: Date.now(),
      contractPath: 'test/contract.json',
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(extensionIssue);
  });
});
