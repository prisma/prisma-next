import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  ExtensionSchemaVerifierOptions,
  FamilyDescriptor,
  SchemaIssue,
  TargetDescriptor,
} from '../types';

export interface VerifySchemaOptions<TSchemaIR = unknown> {
  readonly contractIR: unknown;
  readonly schemaIR: TSchemaIR;
  readonly family: FamilyDescriptor<TSchemaIR>;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions: ReadonlyArray<ExtensionDescriptor>;
  readonly driver: ControlPlaneDriver;
  readonly strict: boolean;
}

export interface VerifySchemaResult {
  readonly issues: readonly SchemaIssue[];
}

/**
 * Compares contract IR against schema IR and returns schema issues.
 * This is a helper function that performs the core comparison logic.
 * Used by verifySchemaAgainstContract as a fallback when family hook is not provided.
 */
function compareContractToSchema(contractIR: unknown, schemaIR: unknown): SchemaIssue[] {
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

  return issues;
}

/**
 * Verifies that the schema IR matches the contract IR.
 * If family.verify.verifySchema is provided, defers to it; otherwise uses generic comparison.
 * Also calls extension verifySchema hooks and aggregates all issues.
 */
export async function verifySchemaAgainstContract<TSchemaIR = unknown>(
  options: VerifySchemaOptions<TSchemaIR>,
): Promise<VerifySchemaResult> {
  const { contractIR, schemaIR, family, target, adapter, extensions, driver, strict } = options;

  let issues: SchemaIssue[] = [];

  // If family provides verifySchema hook, use it; otherwise use generic comparison
  if (family.verify?.verifySchema) {
    const result = await family.verify.verifySchema({
      contractIR,
      schemaIR,
      target,
      adapter,
      extensions,
    });
    // Defensive check: ensure result.issues is an array
    if (!result || !Array.isArray(result.issues)) {
      throw new Error(
        `Family verifySchema hook returned invalid result: expected { issues: SchemaIssue[] }, got ${JSON.stringify(result)}`,
      );
    }
    issues = [...result.issues];
  } else {
    // Fallback: use generic comparison
    issues = compareContractToSchema(contractIR, schemaIR);
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

  return { issues: allIssues };
}
