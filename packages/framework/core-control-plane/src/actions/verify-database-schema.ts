import { errorUnexpected } from '../errors';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  ExtensionSchemaVerifierOptions,
  FamilyDescriptor,
  TargetDescriptor,
} from '../types';

export interface VerifyDatabaseSchemaOptions {
  readonly driver: ControlPlaneDriver;
  readonly contractIR: unknown;
  readonly family: FamilyDescriptor;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions: ReadonlyArray<ExtensionDescriptor>;
  readonly strict: boolean;
  readonly startTime: number;
  readonly contractPath: string;
  readonly configPath?: string;
}

export interface SchemaIssue {
  readonly kind:
    | 'missing_table'
    | 'missing_column'
    | 'type_mismatch'
    | 'nullability_mismatch'
    | 'primary_key_mismatch'
    | 'foreign_key_mismatch'
    | 'unique_constraint_mismatch'
    | 'index_mismatch'
    | 'extension_missing';
  readonly table: string;
  readonly column?: string;
  readonly indexOrConstraint?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly message: string;
}

export interface VerifyDatabaseSchemaResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly summary: string;
  readonly contract: {
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly schema: {
    readonly issues: readonly SchemaIssue[];
  };
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
    readonly strict: boolean;
  };
  readonly timings: {
    readonly total: number;
  };
}

/**
 * Programmatic API for verifying database schema against emitted contract.
 * This is the core target-agnostic verification logic that:
 * 1. Introspects database schema via family hook
 * 2. Compares contract against schema IR
 * 3. Calls extension verifySchema hooks
 * 4. Aggregates all issues
 *
 * @param options - Options for database schema verification
 * @returns Result with verification status, schema issues, meta, and timings
 * @throws Error if database connection fails or verification fails
 */
export async function verifyDatabaseSchema(
  options: VerifyDatabaseSchemaOptions,
): Promise<VerifyDatabaseSchemaResult> {
  try {
    const {
      driver,
      contractIR,
      family,
      target,
      adapter,
      extensions,
      strict,
      startTime,
      contractPath,
      configPath,
    } = options;

    // Type guard to ensure contract has required properties
    if (
      typeof contractIR !== 'object' ||
      contractIR === null ||
      !('coreHash' in contractIR) ||
      !('target' in contractIR) ||
      typeof contractIR.coreHash !== 'string' ||
      typeof contractIR.target !== 'string'
    ) {
      throw errorUnexpected('Invalid contract structure', {
        why: 'Contract is missing required fields: coreHash or target',
      });
    }

    // Extract contract hashes
    const contractCoreHash = contractIR.coreHash;
    const contractProfileHash =
      'profileHash' in contractIR && typeof contractIR.profileHash === 'string'
        ? contractIR.profileHash
        : undefined;

    // Check for family introspectSchema hook
    if (!family.verify?.introspectSchema) {
      throw errorUnexpected('Family introspectSchema() is required', {
        why: 'Family verify.introspectSchema is required for schema verification',
      });
    }

    // Introspect database schema via family hook
    const schemaIR = await family.verify.introspectSchema({
      driver,
      contractIR,
      target,
      adapter,
      extensions,
    });

    // Compare contract against schema IR (core comparison logic)
    const issues: SchemaIssue[] = [];

    // Type guard to check if contract has storage.tables
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

      // Type guard to check if schemaIR has tables
      if (
        typeof schemaIR === 'object' &&
        schemaIR !== null &&
        'tables' in schemaIR &&
        typeof schemaIR.tables === 'object' &&
        schemaIR.tables !== null
      ) {
        const schemaTables = schemaIR.tables as Record<string, unknown>;

        // Compare each contract table against schema IR
        for (const [tableName, contractTable] of Object.entries(contractTables)) {
          const schemaTable = schemaTables[tableName];

          // Check if table exists
          if (!schemaTable) {
            issues.push({
              kind: 'missing_table',
              table: tableName,
              message: `Table ${tableName} is not present in database`,
            });
            continue;
          }

          // Type guard for contract table structure
          if (
            typeof contractTable === 'object' &&
            contractTable !== null &&
            'columns' in contractTable &&
            typeof contractTable.columns === 'object' &&
            contractTable.columns !== null
          ) {
            const contractColumns = contractTable.columns as Record<string, unknown>;

            // Type guard for schema table structure
            if (
              typeof schemaTable === 'object' &&
              schemaTable !== null &&
              'columns' in schemaTable &&
              typeof schemaTable.columns === 'object' &&
              schemaTable.columns !== null
            ) {
              const schemaColumns = schemaTable.columns as Record<string, unknown>;

              // Compare columns
              for (const [columnName, contractColumn] of Object.entries(contractColumns)) {
                const schemaColumn = schemaColumns[columnName];

                if (!schemaColumn) {
                  issues.push({
                    kind: 'missing_column',
                    table: tableName,
                    column: columnName,
                    message: `Column ${tableName}.${columnName} is not present in database`,
                  });
                  continue;
                }

                // Type guard for contract column
                if (
                  typeof contractColumn === 'object' &&
                  contractColumn !== null &&
                  'type' in contractColumn &&
                  typeof contractColumn.type === 'string' &&
                  'nullable' in contractColumn &&
                  typeof contractColumn.nullable === 'boolean'
                ) {
                  const contractType = contractColumn.type;
                  const contractNullable = contractColumn.nullable;

                  // Type guard for schema column
                  if (
                    typeof schemaColumn === 'object' &&
                    schemaColumn !== null &&
                    'typeId' in schemaColumn &&
                    typeof schemaColumn.typeId === 'string' &&
                    'nullable' in schemaColumn &&
                    typeof schemaColumn.nullable === 'boolean'
                  ) {
                    const schemaTypeId = schemaColumn.typeId;
                    const schemaNullable = schemaColumn.nullable;

                    // Check type compatibility
                    if (contractType !== schemaTypeId) {
                      issues.push({
                        kind: 'type_mismatch',
                        table: tableName,
                        column: columnName,
                        expected: contractType,
                        actual: schemaTypeId,
                        message: `Column ${tableName}.${columnName} type mismatch: expected ${contractType}, found ${schemaTypeId}`,
                      });
                    }

                    // Check nullability
                    if (contractNullable !== schemaNullable) {
                      issues.push({
                        kind: 'nullability_mismatch',
                        table: tableName,
                        column: columnName,
                        expected: contractNullable ? 'nullable' : 'not null',
                        actual: schemaNullable ? 'nullable' : 'not null',
                        message: `Column ${tableName}.${columnName} nullability mismatch: expected ${contractNullable ? 'nullable' : 'not null'}, found ${schemaNullable ? 'nullable' : 'not null'}`,
                      });
                    }
                  }
                }
              }

              // Compare primary key
              // Both Contract and SchemaIR now use { columns: string[]; name?: string } format
              const contractPrimaryKey =
                'primaryKey' in contractTable &&
                contractTable.primaryKey !== null &&
                contractTable.primaryKey !== undefined &&
                typeof contractTable.primaryKey === 'object' &&
                'columns' in contractTable.primaryKey &&
                Array.isArray(contractTable.primaryKey.columns)
                  ? (contractTable.primaryKey.columns as readonly string[])
                  : undefined;
              const schemaPrimaryKey =
                'primaryKey' in schemaTable &&
                schemaTable.primaryKey !== null &&
                schemaTable.primaryKey !== undefined &&
                typeof schemaTable.primaryKey === 'object' &&
                'columns' in schemaTable.primaryKey &&
                Array.isArray(schemaTable.primaryKey.columns)
                  ? (schemaTable.primaryKey.columns as readonly string[])
                  : undefined;

              if (contractPrimaryKey && !schemaPrimaryKey) {
                issues.push({
                  kind: 'primary_key_mismatch',
                  table: tableName,
                  expected: contractPrimaryKey.join(', '),
                  message: `Table ${tableName} primary key mismatch: expected [${contractPrimaryKey.join(', ')}], found none`,
                });
              } else if (
                contractPrimaryKey &&
                schemaPrimaryKey &&
                JSON.stringify([...contractPrimaryKey].sort()) !==
                  JSON.stringify([...schemaPrimaryKey].sort())
              ) {
                issues.push({
                  kind: 'primary_key_mismatch',
                  table: tableName,
                  expected: contractPrimaryKey.join(', '),
                  actual: schemaPrimaryKey.join(', '),
                  message: `Table ${tableName} primary key mismatch: expected [${contractPrimaryKey.join(', ')}], found [${schemaPrimaryKey.join(', ')}]`,
                });
              }

              // Compare foreign keys
              const contractForeignKeys =
                'foreignKeys' in contractTable && Array.isArray(contractTable.foreignKeys)
                  ? (contractTable.foreignKeys as ReadonlyArray<unknown>)
                  : [];
              const schemaForeignKeys =
                'foreignKeys' in schemaTable && Array.isArray(schemaTable.foreignKeys)
                  ? (schemaTable.foreignKeys as ReadonlyArray<unknown>)
                  : [];

              // For now, we'll do a simple count check. Full FK comparison can be added later.
              // This is a simplified comparison - full implementation would compare FK sets.
              if (contractForeignKeys.length !== schemaForeignKeys.length) {
                issues.push({
                  kind: 'foreign_key_mismatch',
                  table: tableName,
                  expected: `${contractForeignKeys.length} foreign key(s)`,
                  actual: `${schemaForeignKeys.length} foreign key(s)`,
                  message: `Table ${tableName} foreign key count mismatch: expected ${contractForeignKeys.length}, found ${schemaForeignKeys.length}`,
                });
              }

              // Compare unique constraints
              const contractUniques =
                'uniques' in contractTable && Array.isArray(contractTable.uniques)
                  ? (contractTable.uniques as ReadonlyArray<unknown>)
                  : [];
              const schemaUniques =
                'uniques' in schemaTable && Array.isArray(schemaTable.uniques)
                  ? (schemaTable.uniques as ReadonlyArray<unknown>)
                  : [];

              if (contractUniques.length !== schemaUniques.length) {
                issues.push({
                  kind: 'unique_constraint_mismatch',
                  table: tableName,
                  expected: `${contractUniques.length} unique constraint(s)`,
                  actual: `${schemaUniques.length} unique constraint(s)`,
                  message: `Table ${tableName} unique constraint count mismatch: expected ${contractUniques.length}, found ${schemaUniques.length}`,
                });
              }

              // Compare indexes
              const contractIndexes =
                'indexes' in contractTable && Array.isArray(contractTable.indexes)
                  ? (contractTable.indexes as ReadonlyArray<unknown>)
                  : [];
              const schemaIndexes =
                'indexes' in schemaTable && Array.isArray(schemaTable.indexes)
                  ? (schemaTable.indexes as ReadonlyArray<unknown>)
                  : [];

              if (contractIndexes.length !== schemaIndexes.length) {
                issues.push({
                  kind: 'index_mismatch',
                  table: tableName,
                  expected: `${contractIndexes.length} index(es)`,
                  actual: `${schemaIndexes.length} index(es)`,
                  message: `Table ${tableName} index count mismatch: expected ${contractIndexes.length}, found ${schemaIndexes.length}`,
                });
              }
            }
          }
        }
      }
    }

    // Call extension verifySchema hooks
    const extensionIssues: SchemaIssue[] = [];
    for (const extension of extensions) {
      if (extension.verifySchema) {
        const extensionOptions: ExtensionSchemaVerifierOptions = {
          driver,
          contractIR,
          schemaIR,
          strict,
        };
        const extIssues = await extension.verifySchema(extensionOptions);
        // Map extension issues to SchemaIssue format
        for (const extIssue of extIssues) {
          extensionIssues.push({
            kind: extIssue.kind as SchemaIssue['kind'],
            table: extIssue.table ?? '',
            ...(extIssue.column ? { column: extIssue.column } : {}),
            ...(extIssue.detail ? { indexOrConstraint: JSON.stringify(extIssue.detail) } : {}),
            message: extIssue.message,
          });
        }
      }
    }

    // Aggregate all issues
    const allIssues = [...issues, ...extensionIssues];

    // Calculate timings
    const totalTime = Date.now() - startTime;

    // Determine result
    const ok = allIssues.length === 0;
    const summary = ok
      ? 'Database schema matches contract'
      : `Contract requirements not met: ${allIssues.length} issue${allIssues.length === 1 ? '' : 's'} found`;

    return {
      ok,
      ...(ok ? {} : { code: 'PN-SCHEMA-0001' }),
      summary,
      contract: {
        coreHash: contractCoreHash,
        ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
      },
      target: {
        expected: target.id,
      },
      schema: {
        issues: allIssues,
      },
      meta: {
        ...(configPath ? { configPath } : {}),
        contractPath,
        strict,
      },
      timings: {
        total: totalTime,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to verify database schema: ${String(error)}`);
  }
}
