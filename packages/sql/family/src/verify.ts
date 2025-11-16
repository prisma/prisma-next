import { introspectPostgresSchema } from '@prisma-next/adapter-postgres/introspect';
import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  SchemaIssue,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { type } from 'arktype';
import type { SqlFamilyContext } from './context';
import type { SqlTypeMetadataRegistry } from './types';

const MetaSchema = type({ '[string]': 'unknown' });

function parseMeta(meta: unknown): Record<string, unknown> {
  if (meta === null || meta === undefined) {
    return {};
  }

  let parsed: unknown;
  if (typeof meta === 'string') {
    try {
      parsed = JSON.parse(meta);
    } catch {
      return {};
    }
  } else {
    parsed = meta;
  }

  const result = MetaSchema(parsed);
  if (result instanceof type.errors) {
    return {};
  }

  return result as Record<string, unknown>;
}

const ContractMarkerRowSchema = type({
  core_hash: 'string',
  profile_hash: 'string',
  'contract_json?': 'unknown | null',
  'canonical_version?': 'number | null',
  'updated_at?': 'Date | string',
  'app_tag?': 'string | null',
  'meta?': 'unknown | null',
});

/**
 * Parses a contract marker row from database query result.
 * This is SQL-specific parsing logic (handles SQL row structure with snake_case columns).
 */
export function parseContractMarkerRow(row: unknown): ContractMarkerRecord {
  const result = ContractMarkerRowSchema(row);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid contract marker row: ${messages}`);
  }

  const validatedRow = result as {
    core_hash: string;
    profile_hash: string;
    contract_json?: unknown | null;
    canonical_version?: number | null;
    updated_at?: Date | string;
    app_tag?: string | null;
    meta?: unknown | null;
  };

  const updatedAt = validatedRow.updated_at
    ? validatedRow.updated_at instanceof Date
      ? validatedRow.updated_at
      : new Date(validatedRow.updated_at)
    : new Date();

  return {
    coreHash: validatedRow.core_hash,
    profileHash: validatedRow.profile_hash,
    contractJson: validatedRow.contract_json ?? null,
    canonicalVersion: validatedRow.canonical_version ?? null,
    updatedAt,
    appTag: validatedRow.app_tag ?? null,
    meta: parseMeta(validatedRow.meta),
  };
}

/**
 * Returns the SQL statement to read the contract marker.
 * This is a migration-plane helper (no runtime imports).
 * @internal - Used internally by readMarker(). Prefer readMarker() for Control Plane usage.
 */
export function readMarkerSql(): { readonly sql: string; readonly params: readonly unknown[] } {
  return {
    sql: `select
      core_hash,
      profile_hash,
      contract_json,
      canonical_version,
      updated_at,
      app_tag,
      meta
    from prisma_contract.marker
    where id = $1`,
    params: [1],
  };
}

/**
 * Reads the contract marker from the database using the provided driver.
 * Returns the parsed marker record or null if no marker is found.
 * This abstracts SQL-specific details from the Control Plane.
 *
 * @param driver - ControlPlaneDriver instance for executing queries
 * @returns Promise resolving to ContractMarkerRecord or null if marker not found
 */
export async function readMarker(driver: ControlPlaneDriver): Promise<ContractMarkerRecord | null> {
  const markerStatement = readMarkerSql();
  const queryResult = await driver.query<{
    core_hash: string;
    profile_hash: string;
    contract_json: unknown | null;
    canonical_version: number | null;
    updated_at: Date | string;
    app_tag: string | null;
    meta: unknown | null;
  }>(markerStatement.sql, markerStatement.params);

  if (queryResult.rows.length === 0) {
    return null;
  }

  const markerRow = queryResult.rows[0];
  if (!markerRow) {
    // If rows array has length > 0 but first element is undefined, this is an unexpected result structure
    throw new Error('Database query returned unexpected result structure');
  }

  return parseContractMarkerRow(markerRow);
}

/**
 * Collects supported codec type IDs from adapter and extension manifests.
 * Returns a sorted, unique array of type IDs that are declared in the manifests.
 * This enables coverage checks by comparing contract column types against supported types.
 *
 * Note: This extracts type IDs from manifest type imports, not from runtime codec registries.
 * The manifests declare which codec types are available, but the actual type IDs
 * are defined in the codec-types TypeScript modules that are imported.
 *
 * For MVP, we return an empty array since extracting type IDs from TypeScript modules
 * would require runtime evaluation or static analysis. This can be enhanced later.
 */
export function collectSupportedCodecTypeIds(
  descriptors: ReadonlyArray<
    | TargetDescriptor<SqlFamilyContext>
    | AdapterDescriptor<SqlFamilyContext>
    | ExtensionDescriptor<SqlFamilyContext>
  >,
): readonly string[] {
  // For MVP, return empty array
  // Future enhancement: Extract type IDs from codec-types modules via static analysis
  // or require manifests to explicitly list supported type IDs
  void descriptors;
  return [];
}

/**
 * Introspects the database schema and returns a target-agnostic SqlSchemaIR.
 * Delegates to Postgres adapter for concrete introspection.
 * This is the SQL family's implementation of the introspectSchema hook.
 * The contextInput contains the types registry, pre-assembled by the domain layer.
 */
export async function introspectSchema(options: {
  readonly driver: ControlPlaneDriver;
  readonly contextInput: Omit<SqlFamilyContext, 'schemaIR'>;
  readonly contractIR?: unknown;
  readonly target: TargetDescriptor<SqlFamilyContext>;
  readonly adapter: AdapterDescriptor<SqlFamilyContext>;
  readonly extensions: ReadonlyArray<ExtensionDescriptor<SqlFamilyContext>>;
}): Promise<SqlSchemaIR> {
  const { driver, contractIR, contextInput } = options;
  // Extract types from contextInput
  // contextInput is Omit<SqlFamilyContext, 'schemaIR'>, which contains types
  const types: SqlTypeMetadataRegistry = contextInput.types;

  // Delegate to Postgres adapter for concrete introspection
  // For now, we only support Postgres. In the future, this can branch on target.id
  if (options.target.id !== 'postgres') {
    throw new Error(`Schema introspection for target '${options.target.id}' is not yet supported`);
  }

  return introspectPostgresSchema(driver, types, contractIR);
}

/**
 * Verifies that the schema IR matches the contract IR.
 * Compares contract against schema IR and returns schema issues.
 * This is a low-level hook that performs comparison only; extension hooks are handled by domain actions.
 */
export async function verifySchema(options: {
  readonly contractIR: unknown;
  readonly schemaIR: SqlSchemaIR;
  readonly target: TargetDescriptor<SqlFamilyContext>;
  readonly adapter: AdapterDescriptor<SqlFamilyContext>;
  readonly extensions: ReadonlyArray<ExtensionDescriptor<SqlFamilyContext>>;
}): Promise<{ readonly issues: readonly SchemaIssue[] }> {
  const { contractIR, schemaIR } = options;
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

  return { issues };
}
