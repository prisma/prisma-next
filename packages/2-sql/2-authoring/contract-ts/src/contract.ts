import type {
  EnumDefinition,
  ForeignKey,
  ForeignKeyReferences,
  Index,
  ModelDefinition,
  ModelField,
  ModelStorage,
  PrimaryKey,
  SqlContract,
  SqlMappings,
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
  UniqueConstraint,
} from '@prisma-next/sql-contract/types';
import { type } from 'arktype';
import type { O } from 'ts-toolbelt';

/**
 * Structural validation schema for SqlContract using Arktype.
 * This validates the shape and types of the contract structure.
 */
const StorageColumnSchema = type.declare<StorageColumn>().type({
  nativeType: 'string',
  codecId: 'string',
  nullable: 'boolean',
  'typeParams?': 'Record<string, unknown>',
  'typeRef?': 'string',
});

const StorageTypeInstanceSchema = type.declare<StorageTypeInstance>().type({
  codecId: 'string',
  nativeType: 'string',
  typeParams: 'Record<string, unknown>',
});

const PrimaryKeySchema = type.declare<PrimaryKey>().type({
  columns: type.string.array().readonly(),
  'name?': 'string',
});

const UniqueConstraintSchema = type.declare<UniqueConstraint>().type({
  columns: type.string.array().readonly(),
  'name?': 'string',
});

const IndexSchema = type.declare<Index>().type({
  columns: type.string.array().readonly(),
  'name?': 'string',
});

const ForeignKeyReferencesSchema = type.declare<ForeignKeyReferences>().type({
  table: 'string',
  columns: type.string.array().readonly(),
});

const ForeignKeySchema = type.declare<ForeignKey>().type({
  columns: type.string.array().readonly(),
  references: ForeignKeyReferencesSchema,
  'name?': 'string',
});

const StorageTableSchema = type.declare<StorageTable>().type({
  columns: type({ '[string]': StorageColumnSchema }),
  'primaryKey?': PrimaryKeySchema,
  uniques: UniqueConstraintSchema.array().readonly(),
  indexes: IndexSchema.array().readonly(),
  foreignKeys: ForeignKeySchema.array().readonly(),
});

const EnumDefinitionSchema = type.declare<EnumDefinition>().type({
  values: type.string.array().readonly(),
  'name?': 'string',
});

const StorageSchema = type.declare<SqlStorage>().type({
  tables: type({ '[string]': StorageTableSchema }),
  'types?': type({ '[string]': StorageTypeInstanceSchema }),
  'enums?': type({ '[string]': EnumDefinitionSchema }),
});

const ModelFieldSchema = type.declare<ModelField>().type({
  column: 'string',
});

const ModelStorageSchema = type.declare<ModelStorage>().type({
  table: 'string',
});

const ModelSchema = type.declare<ModelDefinition>().type({
  storage: ModelStorageSchema,
  fields: type({ '[string]': ModelFieldSchema }),
  relations: type({ '[string]': 'unknown' }),
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
  'extensionPacks?': 'Record<string, unknown>',
  'meta?': 'Record<string, unknown>',
  'sources?': 'Record<string, unknown>',
  models: type({ '[string]': ModelSchema }),
  storage: StorageSchema,
});

/**
 * Validates the structural shape of a SqlContract using Arktype.
 *
 * **Responsibility: Validation Only**
 * This function validates that the contract has the correct structure and types.
 * It does NOT normalize the contract - normalization must happen in the contract builder.
 *
 * The contract passed to this function must already be normalized (all required fields present).
 * If normalization is needed, it should be done by the contract builder before calling this function.
 *
 * This ensures all required fields are present and have the correct types.
 *
 * @param value - The contract value to validate (typically from a JSON import)
 * @returns The validated contract if structure is valid
 * @throws Error if the contract structure is invalid
 */
function validateContractStructure<T extends SqlContract<SqlStorage>>(
  value: unknown,
): O.Overwrite<T, { targetFamily: 'sql' }> {
  // Check targetFamily first to provide a clear error message for unsupported target families
  const rawValue = value as { targetFamily?: string };
  if (rawValue.targetFamily !== undefined && rawValue.targetFamily !== 'sql') {
    /* c8 ignore next */
    throw new Error(`Unsupported target family: ${rawValue.targetFamily}`);
  }

  const contractResult = SqlContractSchema(value);

  if (contractResult instanceof type.errors) {
    const messages = contractResult.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Contract structural validation failed: ${messages}`);
  }

  // After validation, contractResult matches the schema and preserves the input structure
  // TypeScript needs an assertion here due to exactOptionalPropertyTypes differences
  // between Arktype's inferred type and the generic T, but runtime-wise they're compatible
  return contractResult as O.Overwrite<T, { targetFamily: 'sql' }>;
}

/**
 * Computes mapping dictionaries from models and storage structures.
 * Assumes valid input - validation happens separately in validateContractLogic().
 *
 * @param models - Models object from contract
 * @param storage - Storage object from contract
 * @param existingMappings - Existing mappings from contract input (optional)
 * @returns Computed mappings dictionary
 */
export function computeMappings(
  models: Record<string, ModelDefinition>,
  _storage: SqlStorage,
  existingMappings?: Partial<SqlMappings>,
): SqlMappings {
  const modelToTable: Record<string, string> = {};
  const tableToModel: Record<string, string> = {};
  const fieldToColumn: Record<string, Record<string, string>> = {};
  const columnToField: Record<string, Record<string, string>> = {};

  for (const [modelName, model] of Object.entries(models)) {
    const tableName = model.storage.table;
    modelToTable[modelName] = tableName;
    tableToModel[tableName] = modelName;

    const modelFieldToColumn: Record<string, string> = {};
    for (const [fieldName, field] of Object.entries(model.fields)) {
      const columnName = field.column;
      modelFieldToColumn[fieldName] = columnName;

      if (!columnToField[tableName]) {
        columnToField[tableName] = {};
      }
      columnToField[tableName][columnName] = fieldName;
    }
    fieldToColumn[modelName] = modelFieldToColumn;
  }

  // Preserve existing mappings if provided, otherwise use computed ones
  return {
    modelToTable: existingMappings?.modelToTable ?? modelToTable,
    tableToModel: existingMappings?.tableToModel ?? tableToModel,
    fieldToColumn: existingMappings?.fieldToColumn ?? fieldToColumn,
    columnToField: existingMappings?.columnToField ?? columnToField,
    codecTypes: existingMappings?.codecTypes ?? {},
    operationTypes: existingMappings?.operationTypes ?? {},
  };
}

/**
 * Validates logical consistency of a **structurally validated** SqlContract.
 * This checks that references (e.g., foreign keys, primary keys, uniques) point to storage objects that already exist.
 * Structural validation is expected to have already completed before this helper runs.
 *
 * @param structurallyValidatedContract - The contract whose structure has already been validated
 * @throws Error if logical validation fails
 */
function validateContractLogic(structurallyValidatedContract: SqlContract<SqlStorage>): void {
  const { storage, models } = structurallyValidatedContract;
  const tableNames = new Set(Object.keys(storage.tables));
  const typeInstanceNames = new Set(Object.keys(storage.types ?? {}));

  // Validate storage.types if present
  if (storage.types) {
    for (const [typeName, typeInstance] of Object.entries(storage.types)) {
      // Validate typeParams is not an array (arrays are objects in JS but not valid here)
      if (Array.isArray(typeInstance.typeParams)) {
        throw new Error(
          `Type instance "${typeName}" has invalid typeParams: must be a plain object, not an array`,
        );
      }
    }
  }

  // Validate columns in all tables
  for (const [tableName, table] of Object.entries(storage.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      // Validate typeParams and typeRef are mutually exclusive
      if (column.typeParams !== undefined && column.typeRef !== undefined) {
        throw new Error(
          `Column "${columnName}" in table "${tableName}" has both typeParams and typeRef; these are mutually exclusive`,
        );
      }

      // Validate typeParams is not an array (arrays are objects in JS but not valid here)
      if (column.typeParams !== undefined && Array.isArray(column.typeParams)) {
        throw new Error(
          `Column "${columnName}" in table "${tableName}" has invalid typeParams: must be a plain object, not an array`,
        );
      }

      // Validate typeRef points to an existing storage.types key
      if (column.typeRef !== undefined && !typeInstanceNames.has(column.typeRef)) {
        throw new Error(
          `Column "${columnName}" in table "${tableName}" references non-existent type instance "${column.typeRef}" (not found in storage.types)`,
        );
      }
    }
  }

  // Validate models
  for (const [modelName, modelUnknown] of Object.entries(models)) {
    const model = modelUnknown as ModelDefinition;
    // Validate model has storage.table
    if (!model.storage?.table) {
      /* c8 ignore next */
      throw new Error(`Model "${modelName}" is missing storage.table`);
    }

    const tableName = model.storage.table;

    // Validate model's table exists in storage
    if (!tableNames.has(tableName)) {
      /* c8 ignore next */
      throw new Error(`Model "${modelName}" references non-existent table "${tableName}"`);
    }

    const table = storage.tables[tableName];
    if (!table) {
      /* c8 ignore next */
      throw new Error(`Model "${modelName}" references non-existent table "${tableName}"`);
    }

    // Validate model's table has a primary key
    if (!table.primaryKey) {
      /* c8 ignore next */
      throw new Error(`Model "${modelName}" table "${tableName}" is missing a primary key`);
    }

    const columnNames = new Set(Object.keys(table.columns));

    // Validate model fields
    if (!model.fields) {
      /* c8 ignore next */
      throw new Error(`Model "${modelName}" is missing fields`);
    }

    for (const [fieldName, fieldUnknown] of Object.entries(model.fields)) {
      const field = fieldUnknown as { column: string };
      // Validate field has column property
      if (!field.column) {
        /* c8 ignore next */
        throw new Error(`Model "${modelName}" field "${fieldName}" is missing column property`);
      }

      // Validate field's column exists in the model's backing table
      if (!columnNames.has(field.column)) {
        /* c8 ignore next */
        throw new Error(
          `Model "${modelName}" field "${fieldName}" references non-existent column "${field.column}" in table "${tableName}"`,
        );
      }
    }

    // Validate model relations have corresponding foreign keys
    if (model.relations) {
      for (const [relationName, relation] of Object.entries(model.relations)) {
        // For now, we'll do basic validation. Full FK validation can be added later
        // This would require checking that the relation's on.parentCols/childCols match FKs
        if (
          typeof relation === 'object' &&
          relation !== null &&
          'on' in relation &&
          'to' in relation
        ) {
          const on = relation.on as { parentCols?: string[]; childCols?: string[] };
          const cardinality = (relation as { cardinality?: string }).cardinality;
          if (on.parentCols && on.childCols) {
            // For 1:N relations, the foreign key is on the child table
            // For N:1 relations, the foreign key is on the parent table (this table)
            // For now, we'll skip validation for 1:N relations as the FK is on the child table
            // and we'll validate it when we process the child model
            if (cardinality === '1:N') {
              // Foreign key is on the child table, skip validation here
              // It will be validated when we process the child model
              continue;
            }

            // For N:1 relations, check that there's a foreign key matching this relation
            const hasMatchingFk = table.foreignKeys?.some((fk) => {
              return (
                fk.columns.length === on.childCols?.length &&
                fk.columns.every((col, i) => col === on.childCols?.[i]) &&
                fk.references.table &&
                fk.references.columns.length === on.parentCols?.length &&
                fk.references.columns.every((col, i) => col === on.parentCols?.[i])
              );
            });

            if (!hasMatchingFk) {
              /* c8 ignore next */
              throw new Error(
                `Model "${modelName}" relation "${relationName}" does not have a corresponding foreign key in table "${tableName}"`,
              );
            }
          }
        }
      }
    }
  }

  for (const [tableName, table] of Object.entries(storage.tables)) {
    const columnNames = new Set(Object.keys(table.columns));

    // Validate primaryKey references existing columns
    if (table.primaryKey) {
      for (const colName of table.primaryKey.columns) {
        if (!columnNames.has(colName)) {
          /* c8 ignore next */
          throw new Error(
            `Table "${tableName}" primaryKey references non-existent column "${colName}"`,
          );
        }
      }
    }

    // Validate unique constraints reference existing columns
    for (const unique of table.uniques) {
      for (const colName of unique.columns) {
        if (!columnNames.has(colName)) {
          /* c8 ignore next */
          throw new Error(
            `Table "${tableName}" unique constraint references non-existent column "${colName}"`,
          );
        }
      }
    }

    // Validate indexes reference existing columns
    for (const index of table.indexes) {
      for (const colName of index.columns) {
        if (!columnNames.has(colName)) {
          /* c8 ignore next */
          throw new Error(`Table "${tableName}" index references non-existent column "${colName}"`);
        }
      }
    }

    // Validate foreignKeys reference existing tables and columns
    for (const fk of table.foreignKeys) {
      // Validate FK columns exist in the referencing table
      for (const colName of fk.columns) {
        if (!columnNames.has(colName)) {
          /* c8 ignore next */
          throw new Error(
            `Table "${tableName}" foreignKey references non-existent column "${colName}"`,
          );
        }
      }

      // Validate referenced table exists
      if (!tableNames.has(fk.references.table)) {
        /* c8 ignore next */
        throw new Error(
          `Table "${tableName}" foreignKey references non-existent table "${fk.references.table}"`,
        );
      }

      // Validate referenced columns exist in the referenced table
      const referencedTable = storage.tables[fk.references.table];
      if (!referencedTable) {
        /* c8 ignore next */
        throw new Error(
          `Table "${tableName}" foreignKey references non-existent table "${fk.references.table}"`,
        );
      }
      const referencedColumnNames = new Set(Object.keys(referencedTable.columns));

      for (const colName of fk.references.columns) {
        if (!referencedColumnNames.has(colName)) {
          /* c8 ignore next */
          throw new Error(
            `Table "${tableName}" foreignKey references non-existent column "${colName}" in table "${fk.references.table}"`,
          );
        }
      }

      if (fk.columns.length !== fk.references.columns.length) {
        /* c8 ignore next */
        throw new Error(
          `Table "${tableName}" foreignKey column count (${fk.columns.length}) does not match referenced column count (${fk.references.columns.length})`,
        );
      }
    }
  }
}

export function normalizeContract(contract: unknown): SqlContract<SqlStorage> {
  const contractObj = contract as Record<string, unknown>;

  // Only normalize if storage exists (validation will catch if it's missing)
  let normalizedStorage = contractObj['storage'];
  if (normalizedStorage && typeof normalizedStorage === 'object' && normalizedStorage !== null) {
    const storage = normalizedStorage as Record<string, unknown>;
    const tables = storage['tables'] as Record<string, unknown> | undefined;

    if (tables) {
      // Normalize storage tables
      const normalizedTables: Record<string, unknown> = {};
      for (const [tableName, table] of Object.entries(tables)) {
        const tableObj = table as Record<string, unknown>;
        const columns = tableObj['columns'] as Record<string, unknown> | undefined;

        if (columns) {
          // Normalize columns: add nullable: false if missing
          const normalizedColumns: Record<string, unknown> = {};
          for (const [columnName, column] of Object.entries(columns)) {
            const columnObj = column as Record<string, unknown>;
            const normalizedColumn: Record<string, unknown> = {
              ...columnObj,
              nullable: columnObj['nullable'] ?? false,
            };

            normalizedColumns[columnName] = normalizedColumn;
          }

          // Normalize table arrays: add empty arrays if missing
          normalizedTables[tableName] = {
            ...tableObj,
            columns: normalizedColumns,
            uniques: tableObj['uniques'] ?? [],
            indexes: tableObj['indexes'] ?? [],
            foreignKeys: tableObj['foreignKeys'] ?? [],
          };
        } else {
          normalizedTables[tableName] = tableObj;
        }
      }

      normalizedStorage = {
        ...storage,
        tables: normalizedTables,
      };
    }
  }

  // Only normalize if models exists (validation will catch if it's missing)
  let normalizedModels = contractObj['models'];
  if (normalizedModels && typeof normalizedModels === 'object' && normalizedModels !== null) {
    const models = normalizedModels as Record<string, unknown>;
    const normalizedModelsObj: Record<string, unknown> = {};
    for (const [modelName, model] of Object.entries(models)) {
      const modelObj = model as Record<string, unknown>;
      normalizedModelsObj[modelName] = {
        ...modelObj,
        relations: modelObj['relations'] ?? {},
      };
    }
    normalizedModels = normalizedModelsObj;
  }

  // Normalize top-level fields: add empty objects if missing
  return {
    ...contractObj,
    models: normalizedModels,
    relations: contractObj['relations'] ?? {},
    storage: normalizedStorage,
    extensionPacks: contractObj['extensionPacks'] ?? {},
    capabilities: contractObj['capabilities'] ?? {},
    meta: contractObj['meta'] ?? {},
    sources: contractObj['sources'] ?? {},
  } as SqlContract<SqlStorage>;
}

/**
 * Validates that a JSON import conforms to the SqlContract structure
 * and returns a fully typed SqlContract.
 *
 * This function is specifically for validating JSON imports (e.g., from contract.json).
 * Contracts created via the builder API (defineContract) are already valid and should
 * not be passed to this function - use them directly without validation.
 *
 * Performs both structural validation (using Arktype) and logical validation
 * (ensuring all references are valid).
 *
 *
 * The type parameter `TContract` must be a fully-typed contract type (e.g., from `contract.d.ts`),
 * NOT a generic `SqlContract<SqlStorage>`.
 *
 * **Correct:**
 * ```typescript
 * import type { Contract } from './contract.d';
 * const contract = validateContract<Contract>(contractJson);
 * ```
 *
 * **Incorrect:**
 * ```typescript
 * import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
 * const contract = validateContract<SqlContract<SqlStorage>>(contractJson);
 * // ❌ Types will be inferred as 'unknown' - this won't work!
 * ```
 *
 * The type parameter provides the specific table structure, column types, and model definitions.
 * This function validates the runtime structure matches the type, but does not infer types
 * from JSON (as JSON imports lose literal type information).
 *
 * @param value - The contract value to validate (must be from a JSON import, not a builder)
 * @returns A validated contract matching the TContract type
 * @throws Error if the contract structure or logic is invalid
 */
export function validateContract<TContract extends SqlContract<SqlStorage>>(
  value: unknown,
): TContract {
  // Normalize contract first (add defaults for missing fields)
  const normalized = normalizeContract(value);

  const structurallyValid = validateContractStructure<SqlContract<SqlStorage>>(normalized);

  const contractForValidation = structurallyValid as SqlContract<SqlStorage>;

  // Validate contract logic (contracts must already have fully qualified type IDs)
  validateContractLogic(contractForValidation);

  // Extract existing mappings (optional - will be computed if missing)
  const existingMappings = (contractForValidation as { mappings?: Partial<SqlMappings> }).mappings;

  // Compute mappings from models and storage
  const mappings = computeMappings(
    contractForValidation.models as Record<string, ModelDefinition>,
    contractForValidation.storage,
    existingMappings,
  );

  // Add default values for optional metadata fields if missing
  const contractWithMappings = {
    ...structurallyValid,
    models: contractForValidation.models,
    relations: contractForValidation.relations,
    storage: contractForValidation.storage,
    mappings,
  };

  // Type assertion: The caller provides the strict type via TContract.
  // We validate the structure matches, but the precise types come from contract.d.ts
  return contractWithMappings as TContract;
}
