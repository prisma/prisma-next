import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionDescriptor } from '@prisma-next/cli/config-types';
import type {
  ControlPlaneDriver,
  ExtensionSchemaIssue,
  ExtensionSchemaVerifierOptions,
} from '@prisma-next/core-control-plane/types';
import type { ExtensionPackManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { type } from 'arktype';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TypesImportSpecSchema = type({
  package: 'string',
  named: 'string',
  alias: 'string',
});

const ExtensionPackManifestSchema = type({
  id: 'string',
  version: 'string',
  'targets?': type({ '[string]': type({ 'minVersion?': 'string' }) }),
  'capabilities?': 'Record<string, unknown>',
  'types?': type({
    'codecTypes?': type({
      import: TypesImportSpecSchema,
    }),
    'operationTypes?': type({
      import: TypesImportSpecSchema,
    }),
  }),
  'operations?': 'unknown[]',
});

/**
 * Loads the extension pack manifest from packs/manifest.json.
 */
function loadExtensionManifest(): ExtensionPackManifest {
  const manifestPath = join(__dirname, '../../packs/manifest.json');
  const manifestJson = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  const result = ExtensionPackManifestSchema(manifestJson);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid extension manifest structure at ${manifestPath}: ${messages}`);
  }

  return result as ExtensionPackManifest;
}

/**
 * Verifies pgvector-specific schema invariants.
 * Checks that:
 * 1. Vector extension is installed if contract uses pg/vector@1 columns
 * 2. pg/vector@1 columns have compatible nativeType ('vector')
 */
async function verifyPgvectorSchema(
  options: ExtensionSchemaVerifierOptions,
): Promise<readonly ExtensionSchemaIssue[]> {
  const { driver, contractIR, schemaIR } = options;
  const issues: ExtensionSchemaIssue[] = [];

  // Type guard to check if contract has storage.tables
  if (
    typeof contractIR !== 'object' ||
    contractIR === null ||
    !('storage' in contractIR) ||
    typeof contractIR.storage !== 'object' ||
    contractIR.storage === null ||
    !('tables' in contractIR.storage) ||
    typeof contractIR.storage.tables !== 'object' ||
    contractIR.storage.tables === null
  ) {
    return issues;
  }

  const contractTables = contractIR.storage.tables as Record<string, unknown>;

  // Check if contract uses pg/vector@1 columns
  let hasVectorColumns = false;
  for (const contractTable of Object.values(contractTables)) {
    if (
      typeof contractTable === 'object' &&
      contractTable !== null &&
      'columns' in contractTable &&
      typeof contractTable.columns === 'object' &&
      contractTable.columns !== null
    ) {
      const columns = contractTable.columns as Record<string, unknown>;
      for (const column of Object.values(columns)) {
        if (
          typeof column === 'object' &&
          column !== null &&
          'type' in column &&
          typeof column.type === 'string' &&
          column.type === 'pg/vector@1'
        ) {
          hasVectorColumns = true;
          break;
        }
      }
      if (hasVectorColumns) {
        break;
      }
    }
  }

  if (!hasVectorColumns) {
    // No vector columns in contract, nothing to verify
    return issues;
  }

  // Check if vector extension is installed
  // Query pg_extension to check for vector extension
  const extensionResult = await driver.query<{ extname: string }>(
    'SELECT extname FROM pg_extension WHERE extname = $1',
    ['vector'],
  );

  const vectorExtensionInstalled = extensionResult.rows.length > 0;

  if (!vectorExtensionInstalled) {
    issues.push({
      kind: 'extension_missing',
      message: 'pgvector extension is not installed but contract uses pg/vector@1 columns',
    });
  }

  // Type guard to check if schemaIR has tables
  if (
    typeof schemaIR === 'object' &&
    schemaIR !== null &&
    'tables' in schemaIR &&
    typeof schemaIR.tables === 'object' &&
    schemaIR.tables !== null
  ) {
    const schemaTables = schemaIR.tables as Record<string, unknown>;

    // Check that pg/vector@1 columns have compatible nativeType
    for (const [tableName, contractTable] of Object.entries(contractTables)) {
      const schemaTable = schemaTables[tableName];
      if (!schemaTable) {
        continue;
      }

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
          if (
            typeof contractColumn === 'object' &&
            contractColumn !== null &&
            'type' in contractColumn &&
            typeof contractColumn.type === 'string' &&
            contractColumn.type === 'pg/vector@1'
          ) {
            const schemaColumn = schemaColumns[columnName];
            if (
              typeof schemaColumn === 'object' &&
              schemaColumn !== null &&
              'typeId' in schemaColumn &&
              typeof schemaColumn.typeId === 'string' &&
              schemaColumn.typeId === 'pg/vector@1'
            ) {
              // Check nativeType compatibility
              const nativeType =
                'nativeType' in schemaColumn && typeof schemaColumn.nativeType === 'string'
                  ? schemaColumn.nativeType
                  : undefined;

              if (nativeType !== 'vector') {
                issues.push({
                  kind: 'type_mismatch',
                  table: tableName,
                  column: columnName,
                  message: `Column ${tableName}.${columnName} has type pg/vector@1 but nativeType is '${nativeType ?? 'unknown'}', expected 'vector'`,
                });
              }
            }
          }
        }
      }
    }
  }

  return issues;
}

/**
 * pgvector extension descriptor for CLI config.
 */
const pgvectorExtensionDescriptor: ExtensionDescriptor = {
  kind: 'extension',
  id: 'pgvector',
  family: 'sql',
  manifest: loadExtensionManifest(),
  verifySchema: verifyPgvectorSchema,
};

export default pgvectorExtensionDescriptor;
