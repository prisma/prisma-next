import { type } from 'arktype';
import type { SqlContract } from '@prisma-next/contract/types';

/**
 * Structural validation schema for SqlContract using Arktype.
 * This validates the shape and types of the contract structure.
 * Note: Record types require manual validation since Arktype doesn't support schema references in Record types.
 */
const StorageColumnSchema = type({
  type: 'string',
  nullable: 'boolean | undefined',
});

const PrimaryKeySchema = type({
  columns: 'string[]',
  name: 'string | undefined',
});

const UniqueConstraintSchema = type({
  columns: 'string[]',
  name: 'string | undefined',
});

const IndexSchema = type({
  columns: 'string[]',
  name: 'string | undefined',
});

const ForeignKeyReferencesSchema = type({
  table: 'string',
  columns: 'string[]',
});

const ForeignKeySchema = type({
  columns: 'string[]',
  references: ForeignKeyReferencesSchema,
  name: 'string | undefined',
});

/**
 * Complete SqlContract schema for structural validation.
 * This validates the entire contract structure at once.
 */
const SqlContractSchema = type({
  schemaVersion: "'1' | undefined",
  target: 'string',
  targetFamily: "'sql'",
  coreHash: 'string',
  profileHash: 'string | undefined',
  capabilities: 'Record<string, Record<string, boolean>> | undefined',
  extensions: 'Record<string, unknown> | undefined',
  meta: 'Record<string, unknown> | undefined',
  sources: 'Record<string, unknown> | undefined',
  storage: {
    tables: 'Record<string, unknown>',
  },
});

/**
 * Validates the structural shape of a SqlContract using Arktype.
 * This ensures all required fields are present and have the correct types.
 *
 * @param value - The contract value to validate (typically from a JSON import)
 * @returns The validated contract if structure is valid
 * @throws Error if the contract structure is invalid
 */
export function validateContractStructure<T extends SqlContract>(value: unknown): T {
  // Normalize missing optional fields to undefined for Arktype validation
  // (Arktype treats missing fields differently than undefined)
  const contract = value as Record<string, unknown>;
  const contractToValidate: Record<string, unknown> = {
    schemaVersion: contract.schemaVersion ?? undefined,
    target: contract.target,
    targetFamily: contract.targetFamily,
    coreHash: contract.coreHash,
    profileHash: contract.profileHash ?? undefined,
    capabilities: contract.capabilities ?? undefined,
    extensions: contract.extensions ?? undefined,
    meta: contract.meta ?? undefined,
    sources: contract.sources ?? undefined,
    storage: contract.storage,
  };

  // Validate entire contract structure using Arktype
  const contractResult = SqlContractSchema(contractToValidate);
  // Arktype returns an array of problems on validation failure
  if (Array.isArray(contractResult)) {
    const messages = contractResult.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Contract structural validation failed: ${messages}`);
  }

  // Validate storage structure manually (since Record types with schema references aren't supported)
  if (typeof contract.storage !== 'object' || contract.storage === null) {
    throw new Error('Contract must have a "storage" object');
  }

  const storage = contract.storage as Record<string, unknown>;

  if (
    typeof storage.tables !== 'object' ||
    storage.tables === null ||
    Array.isArray(storage.tables)
  ) {
    throw new Error('Contract storage must have a "tables" object');
  }

  const tables = storage.tables as Record<string, unknown>;

  // Validate each table structure
  for (const [tableName, tableValue] of Object.entries(tables)) {
    if (typeof tableValue !== 'object' || tableValue === null || Array.isArray(tableValue)) {
      throw new Error(`Table "${tableName}" must be an object`);
    }

    const table = tableValue as Record<string, unknown>;

    // Validate columns
    if (
      typeof table.columns !== 'object' ||
      table.columns === null ||
      Array.isArray(table.columns)
    ) {
      throw new Error(`Table "${tableName}" must have a "columns" object`);
    }

    const columns = table.columns as Record<string, unknown>;

    for (const [columnName, columnValue] of Object.entries(columns)) {
      const colObj = columnValue as Record<string, unknown>;
      const colToValidate: Record<string, unknown> = {
        type: colObj.type,
        nullable: colObj.nullable ?? undefined,
      };
      const columnResult = StorageColumnSchema(colToValidate);
      // Arktype returns an array of problems on validation failure
      if (Array.isArray(columnResult)) {
        const messages = columnResult.map((p: { message: string }) => p.message).join('; ');
        throw new Error(`Column "${tableName}.${columnName}" validation failed: ${messages}`);
      }
    }

    // Validate primaryKey if present
    if (table.primaryKey !== undefined) {
      const pkObj = table.primaryKey as Record<string, unknown>;
      const pkToValidate: Record<string, unknown> = {
        columns: pkObj.columns,
        name: pkObj.name ?? undefined,
      };
      const pkResult = PrimaryKeySchema(pkToValidate);
      if (Array.isArray(pkResult)) {
        const messages = pkResult.map((p: { message: string }) => p.message).join('; ');
        throw new Error(`Table "${tableName}" primaryKey validation failed: ${messages}`);
      }
    }

    // Validate uniques if present
    if (table.uniques !== undefined) {
      if (!Array.isArray(table.uniques)) {
        throw new Error(`Table "${tableName}" uniques must be an array`);
      }

      for (const unique of table.uniques) {
        const uniqueObj = unique as Record<string, unknown>;
        const uniqueToValidate: Record<string, unknown> = {
          columns: uniqueObj.columns,
          name: uniqueObj.name ?? undefined,
        };
        const uniqueResult = UniqueConstraintSchema(uniqueToValidate);
        if (Array.isArray(uniqueResult)) {
          const messages = uniqueResult.map((p: { message: string }) => p.message).join('; ');
          throw new Error(`Table "${tableName}" unique constraint validation failed: ${messages}`);
        }
      }
    }

    // Validate indexes if present
    if (table.indexes !== undefined) {
      if (!Array.isArray(table.indexes)) {
        throw new Error(`Table "${tableName}" indexes must be an array`);
      }

      for (const index of table.indexes) {
        const indexObj = index as Record<string, unknown>;
        const indexToValidate: Record<string, unknown> = {
          columns: indexObj.columns,
          name: indexObj.name ?? undefined,
        };
        const indexResult = IndexSchema(indexToValidate);
        if (Array.isArray(indexResult)) {
          const messages = indexResult.map((p: { message: string }) => p.message).join('; ');
          throw new Error(`Table "${tableName}" index validation failed: ${messages}`);
        }
      }
    }

    // Validate foreignKeys if present
    if (table.foreignKeys !== undefined) {
      if (!Array.isArray(table.foreignKeys)) {
        throw new Error(`Table "${tableName}" foreignKeys must be an array`);
      }

      for (const fk of table.foreignKeys) {
        const fkObj = fk as Record<string, unknown>;
        const fkToValidate: Record<string, unknown> = {
          columns: fkObj.columns,
          references: fkObj.references,
          name: fkObj.name ?? undefined,
        };
        const fkResult = ForeignKeySchema(fkToValidate);
        if (Array.isArray(fkResult)) {
          const messages = fkResult.map((p: { message: string }) => p.message).join('; ');
          throw new Error(`Table "${tableName}" foreignKey validation failed: ${messages}`);
        }
      }
    }
  }

  // Return the original value with preserved literal types
  // Validation has confirmed it matches SqlContract structure
  return value as T;
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

        // Validate FK column count matches referenced column count
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
export function validateContract<T extends SqlContract>(value: unknown): T {
  // First, validate structure using Arktype
  const structurallyValid = validateContractStructure<T>(value);

  // Then, validate logical consistency
  validateContractLogic(structurallyValid);

  return structurallyValid;
}
