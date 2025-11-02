import { type } from 'arktype';
import type { SqlContract } from '@prisma-next/contract/types';

/**
 * Structural validation schema for SqlContract using Arktype.
 * This validates the shape and types of the contract structure.
 */
const StorageColumnSchema = type({
  type: 'string',
  'nullable?': 'boolean',
});

const PrimaryKeySchema = type({
  columns: 'string[]',
  'name?': 'string',
});

const UniqueConstraintSchema = type({
  columns: 'string[]',
  'name?': 'string',
});

const IndexSchema = type({
  columns: 'string[]',
  'name?': 'string',
});

const ForeignKeyReferencesSchema = type({
  table: 'string',
  columns: 'string[]',
});

const ForeignKeySchema = type({
  columns: 'string[]',
  references: ForeignKeyReferencesSchema,
  'name?': 'string',
});

const StorageTableSchema = type({
  columns: type({ '[string]': StorageColumnSchema }),
  'primaryKey?': PrimaryKeySchema,
  'uniques?': UniqueConstraintSchema.array(),
  'indexes?': IndexSchema.array(),
  'foreignKeys?': ForeignKeySchema.array(),
});

const StorageSchema = type({
  tables: type({ '[string]': StorageTableSchema }),
});

/**
 * Complete SqlContract schema for structural validation.
 * This validates the entire contract structure at once.
 */
const SqlContractSchema = type({
  'schemaVersion?': "'1'",
  target: 'string',
  targetFamily: "'sql'",
  coreHash: 'string',
  'profileHash?': 'string',
  'capabilities?': 'Record<string, Record<string, boolean>>',
  'extensions?': 'Record<string, unknown>',
  'meta?': 'Record<string, unknown>',
  'sources?': 'Record<string, unknown>',
  storage: StorageSchema,
});

/**
 * Validates the structural shape of a SqlContract using Arktype.
 * This ensures all required fields are present and have the correct types.
 *
 * @param value - The contract value to validate (typically from a JSON import)
 * @returns The validated contract if structure is valid
 * @throws Error if the contract structure is invalid
 */
export function validateContractStructure<T extends SqlContract>(
  value: T,
): Omit<T, 'targetFamily'> & { targetFamily: 'sql' } {
  const contractResult = SqlContractSchema(value);

  if (contractResult instanceof type.errors) {
    const messages = contractResult.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Contract structural validation failed: ${messages}`);
  }

  // After validation, contractResult matches the schema and preserves the input structure
  // TypeScript needs an assertion here due to exactOptionalPropertyTypes differences
  // between Arktype's inferred type and the generic T, but runtime-wise they're compatible
  return contractResult as Omit<T, 'targetFamily'> & {
    targetFamily: 'sql';
  };
}

/**
 * Validates logical consistency of a SqlContract.
 * This checks that all references are valid (e.g., foreign keys reference existing tables/columns,
 * primary keys reference existing columns, etc.).
 *
 * @param contract - The validated SqlContract to check for logical consistency
 * @throws Error if logical validation fails
 */
export function validateContractLogic(contract: SqlContract): void {
  const { storage } = contract;
  const tableNames = new Set(Object.keys(storage.tables));

  for (const [tableName, table] of Object.entries(storage.tables)) {
    const columnNames = new Set(Object.keys(table.columns));

    // Validate primaryKey references existing columns
    if (table.primaryKey) {
      for (const colName of table.primaryKey.columns) {
        if (!columnNames.has(colName)) {
          throw new Error(
            `Table "${tableName}" primaryKey references non-existent column "${colName}"`,
          );
        }
      }
    }

    // Validate unique constraints reference existing columns
    if (table.uniques) {
      for (const unique of table.uniques) {
        for (const colName of unique.columns) {
          if (!columnNames.has(colName)) {
            throw new Error(
              `Table "${tableName}" unique constraint references non-existent column "${colName}"`,
            );
          }
        }
      }
    }

    // Validate indexes reference existing columns
    if (table.indexes) {
      for (const index of table.indexes) {
        for (const colName of index.columns) {
          if (!columnNames.has(colName)) {
            throw new Error(
              `Table "${tableName}" index references non-existent column "${colName}"`,
            );
          }
        }
      }
    }

    // Validate foreignKeys reference existing tables and columns
    if (table.foreignKeys) {
      for (const fk of table.foreignKeys) {
        // Validate FK columns exist in the referencing table
        for (const colName of fk.columns) {
          if (!columnNames.has(colName)) {
            throw new Error(
              `Table "${tableName}" foreignKey references non-existent column "${colName}"`,
            );
          }
        }

        // Validate referenced table exists
        if (!tableNames.has(fk.references.table)) {
          throw new Error(
            `Table "${tableName}" foreignKey references non-existent table "${fk.references.table}"`,
          );
        }

        // Validate referenced columns exist in the referenced table
        const referencedTable = storage.tables[fk.references.table];
        const referencedColumnNames = new Set(Object.keys(referencedTable.columns));

        for (const colName of fk.references.columns) {
          if (!referencedColumnNames.has(colName)) {
            throw new Error(
              `Table "${tableName}" foreignKey references non-existent column "${colName}" in table "${fk.references.table}"`,
            );
          }
        }

        if (fk.columns.length !== fk.references.columns.length) {
          throw new Error(
            `Table "${tableName}" foreignKey column count (${fk.columns.length}) does not match referenced column count (${fk.references.columns.length})`,
          );
        }
      }
    }
  }
}

/**
 * Validates that an unknown value conforms to the SqlContract structure
 * and returns a fully typed SqlContract with preserved literal types.
 *
 * Performs both structural validation (using Arktype) and logical validation
 * (ensuring all references are valid).
 *
 * @param value - The contract value to validate (typically from a JSON import)
 * @returns A validated SqlContract with preserved type information
 * @throws Error if the contract structure or logic is invalid
 */
export function validateContract<T extends SqlContract>(
  value: T,
): Omit<T, 'targetFamily'> & { targetFamily: 'sql' } {
  const structurallyValid = validateContractStructure<T>(value);

  validateContractLogic(structurallyValid as SqlContract);

  return structurallyValid;
}
