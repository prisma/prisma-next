import { type } from 'arktype';
import type {
  ForeignKey,
  ForeignKeyReferences,
  ForeignKeysConfig,
  Index,
  ModelDefinition,
  ModelField,
  ModelStorage,
  PrimaryKey,
  ReferentialAction,
  SqlContract,
  SqlStorage,
  StorageTable,
  StorageTypeInstance,
  UniqueConstraint,
} from './types';

type ColumnDefaultLiteral = { readonly kind: 'literal'; readonly expression: string };
type ColumnDefaultFunction = { readonly kind: 'function'; readonly expression: string };
const literalKindSchema = type("'literal'");
const functionKindSchema = type("'function'");
const generatorKindSchema = type("'generator'");
const generatorIdSchema = type("'ulid' | 'nanoid' | 'uuidv7' | 'uuidv4' | 'cuid2' | 'ksuid'");

export const ColumnDefaultLiteralSchema = type.declare<ColumnDefaultLiteral>().type({
  kind: literalKindSchema,
  expression: 'string',
});

export const ColumnDefaultFunctionSchema = type.declare<ColumnDefaultFunction>().type({
  kind: functionKindSchema,
  expression: 'string',
});

export const ColumnDefaultSchema = ColumnDefaultLiteralSchema.or(ColumnDefaultFunctionSchema);

const ExecutionMutationDefaultValueSchema = type({
  kind: generatorKindSchema,
  id: generatorIdSchema,
  'params?': 'Record<string, unknown>',
});

const ExecutionMutationDefaultSchema = type({
  ref: {
    table: 'string',
    column: 'string',
  },
  'onCreate?': ExecutionMutationDefaultValueSchema,
  'onUpdate?': ExecutionMutationDefaultValueSchema,
});

const ExecutionSchema = type({
  mutations: {
    defaults: ExecutionMutationDefaultSchema.array().readonly(),
  },
});

const StorageColumnSchema = type({
  nativeType: 'string',
  codecId: 'string',
  nullable: 'boolean',
  'typeParams?': 'Record<string, unknown>',
  'typeRef?': 'string',
  'default?': ColumnDefaultSchema,
}).narrow((col, ctx) => {
  if (col.typeParams !== undefined && col.typeRef !== undefined) {
    return ctx.mustBe('a column with either typeParams or typeRef, not both');
  }
  return true;
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

export const ForeignKeyReferencesSchema = type.declare<ForeignKeyReferences>().type({
  table: 'string',
  columns: type.string.array().readonly(),
});

export const ReferentialActionSchema = type
  .declare<ReferentialAction>()
  .type("'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault'");

export const ForeignKeySchema = type.declare<ForeignKey>().type({
  columns: type.string.array().readonly(),
  references: ForeignKeyReferencesSchema,
  'name?': 'string',
  'onDelete?': ReferentialActionSchema,
  'onUpdate?': ReferentialActionSchema,
});

const StorageTableSchema = type.declare<StorageTable>().type({
  columns: type({ '[string]': StorageColumnSchema }),
  'primaryKey?': PrimaryKeySchema,
  uniques: UniqueConstraintSchema.array().readonly(),
  indexes: IndexSchema.array().readonly(),
  foreignKeys: ForeignKeySchema.array().readonly(),
});

const StorageSchema = type.declare<SqlStorage>().type({
  tables: type({ '[string]': StorageTableSchema }),
  'types?': type({ '[string]': StorageTypeInstanceSchema }),
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

export const ForeignKeysConfigSchema = type.declare<ForeignKeysConfig>().type({
  constraints: 'boolean',
  indexes: 'boolean',
});

const SqlContractSchema = type({
  'schemaVersion?': "'1'",
  target: 'string',
  targetFamily: "'sql'",
  storageHash: 'string',
  'executionHash?': 'string',
  'profileHash?': 'string',
  'capabilities?': 'Record<string, Record<string, boolean>>',
  'extensionPacks?': 'Record<string, unknown>',
  'meta?': 'Record<string, unknown>',
  'sources?': 'Record<string, unknown>',
  models: type({ '[string]': ModelSchema }),
  storage: StorageSchema,
  'execution?': ExecutionSchema,
  'foreignKeys?': ForeignKeysConfigSchema,
});

/**
 * Validates the structural shape of SqlStorage using Arktype.
 *
 * @param value - The storage value to validate
 * @returns The validated storage if structure is valid
 * @throws Error if the storage structure is invalid
 */
export function validateStorage(value: unknown): SqlStorage {
  const result = StorageSchema(value);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Storage validation failed: ${messages}`);
  }
  return result;
}

/**
 * Validates the structural shape of ModelDefinition using Arktype.
 *
 * @param value - The model value to validate
 * @returns The validated model if structure is valid
 * @throws Error if the model structure is invalid
 */
export function validateModel(value: unknown): ModelDefinition {
  const result = ModelSchema(value);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Model validation failed: ${messages}`);
  }
  return result;
}

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
export function validateSqlContract<T extends SqlContract<SqlStorage>>(value: unknown): T {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Contract structural validation failed: value must be an object');
  }

  // Check targetFamily first to provide a clear error message for unsupported target families
  const rawValue = value as { targetFamily?: string };
  if (rawValue.targetFamily !== undefined && rawValue.targetFamily !== 'sql') {
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
  return contractResult as T;
}

/**
 * Validates semantic constraints on SqlStorage that cannot be expressed in Arktype schemas.
 *
 * Returns an array of human-readable error strings. Empty array = valid.
 *
 * Currently checks:
 * - `setNull` referential action on a non-nullable FK column (would fail at runtime)
 * - `setDefault` referential action on a non-nullable FK column without a DEFAULT (would fail at runtime)
 */
export function validateStorageSemantics(storage: SqlStorage): string[] {
  const errors: string[] = [];

  for (const [tableName, table] of Object.entries(storage.tables)) {
    for (const fk of table.foreignKeys) {
      for (const colName of fk.columns) {
        const column = table.columns[colName];
        if (!column) continue;

        if (fk.onDelete === 'setNull' && !column.nullable) {
          errors.push(
            `Table "${tableName}": onDelete setNull on foreign key column "${colName}" which is NOT NULL`,
          );
        }
        if (fk.onUpdate === 'setNull' && !column.nullable) {
          errors.push(
            `Table "${tableName}": onUpdate setNull on foreign key column "${colName}" which is NOT NULL`,
          );
        }
        if (fk.onDelete === 'setDefault' && !column.nullable && column.default === undefined) {
          errors.push(
            `Table "${tableName}": onDelete setDefault on foreign key column "${colName}" which is NOT NULL and has no DEFAULT`,
          );
        }
        if (fk.onUpdate === 'setDefault' && !column.nullable && column.default === undefined) {
          errors.push(
            `Table "${tableName}": onUpdate setDefault on foreign key column "${colName}" which is NOT NULL and has no DEFAULT`,
          );
        }
      }
    }
  }

  return errors;
}
