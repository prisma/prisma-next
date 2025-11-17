import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  SchemaIssue,
  TargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  SqlSchemaIR,
  SqlTypeMetadata,
  SqlTypeMetadataRegistry,
} from '@prisma-next/sql-schema-ir/types';
import type { SqlFamilyContext } from './context';
import { createSqlTypeMetadataRegistry } from './type-metadata';

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
export function supportedTypeIds(
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
 * Prepares family-specific control-plane context from descriptors.
 * For SQL, this constructs a SqlTypeMetadataRegistry from adapter codecs and extension metadata.
 * The returned context is used as input to introspectSchema and other control-plane operations.
 * The context does not contain schemaIR; that is produced separately by introspectSchema.
 */
export async function prepareControlContext(options: {
  readonly contractIR: unknown;
  readonly target: TargetDescriptor<SqlFamilyContext>;
  readonly adapter: AdapterDescriptor<SqlFamilyContext>;
  readonly extensions: ReadonlyArray<ExtensionDescriptor<SqlFamilyContext>>;
}): Promise<SqlFamilyContext> {
  const { adapter: adapterDescriptor, extensions } = options;

  // Hydrate adapter instance (either pre-created or create via factory)
  let adapterInstance:
    | {
        profile: { codecs(): CodecRegistry };
      }
    | undefined;
  if (adapterDescriptor.adapter) {
    adapterInstance = adapterDescriptor.adapter as {
      profile: { codecs(): CodecRegistry };
    };
  } else if (adapterDescriptor.create) {
    const created = await adapterDescriptor.create();
    adapterInstance = created as {
      profile: { codecs(): CodecRegistry };
    };
  }

  // Get codec registry from adapter
  const codecRegistry = adapterInstance?.profile.codecs();

  // Collect extension typeMetadata
  const extensionTypeMetadata: SqlTypeMetadata[] = [];
  for (const extension of extensions) {
    // Check if extension has typeMetadata property (from control-plane extension SPI)
    if (
      typeof extension === 'object' &&
      extension !== null &&
      'typeMetadata' in extension &&
      Array.isArray(extension.typeMetadata)
    ) {
      extensionTypeMetadata.push(...(extension.typeMetadata as SqlTypeMetadata[]));
    }
  }

  // Build type metadata registry from adapter codecs and extension metadata
  const types = createSqlTypeMetadataRegistry([
    ...(codecRegistry ? [{ codecRegistry }] : []),
    ...(extensionTypeMetadata.length > 0 ? [{ typeMetadata: extensionTypeMetadata }] : []),
  ]);

  // Return context with control-plane state (types registry)
  // TargetFamilyContext is a pure type carrier with no runtime fields, so { types } satisfies SqlFamilyContext
  return { types } as SqlFamilyContext;
}

/**
 * Introspects the database schema and returns a target-agnostic SqlSchemaIR.
 * Uses the adapter's introspection function (target-agnostic).
 * This is the SQL family's implementation of the introspectSchema hook.
 * The contextInput contains the types registry, pre-assembled by the domain layer.
 * The schemaIR is returned as a separate value, not stored in the context.
 */
export async function introspectSchema(options: {
  readonly driver: ControlPlaneDriver;
  readonly contextInput: SqlFamilyContext;
  readonly contractIR?: unknown;
  readonly target: TargetDescriptor<SqlFamilyContext>;
  readonly adapter: AdapterDescriptor<SqlFamilyContext>;
  readonly extensions: ReadonlyArray<ExtensionDescriptor<SqlFamilyContext>>;
}): Promise<SqlSchemaIR> {
  const { driver, contractIR, contextInput } = options;
  // Extract types from contextInput
  const types: SqlTypeMetadataRegistry = contextInput.types;

  // Use adapter's introspection function (target-agnostic)
  if (!options.adapter.introspect) {
    throw new Error(`Adapter '${options.adapter.id}' does not provide introspection`);
  }

  const schemaIR = await options.adapter.introspect(driver, types, contractIR);
  return schemaIR as SqlSchemaIR;
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
