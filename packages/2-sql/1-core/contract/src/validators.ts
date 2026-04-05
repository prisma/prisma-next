import type { Contract } from '@prisma-next/contract/types';
import { ContractValidationError } from '@prisma-next/contract/validate-contract';
import { type } from 'arktype';
import type {
  ForeignKey,
  ForeignKeyReferences,
  PrimaryKey,
  ReferentialAction,
  SqlStorage,
  StorageTypeInstance,
  UniqueConstraint,
} from './types';

type ColumnDefaultLiteral = {
  readonly kind: 'literal';
  readonly value: string | number | boolean | Record<string, unknown> | unknown[] | null;
};
type ColumnDefaultFunction = { readonly kind: 'function'; readonly expression: string };
const literalKindSchema = type("'literal'");
const functionKindSchema = type("'function'");
const generatorKindSchema = type("'generator'");
const generatorIdSchema = type('string').narrow((value, ctx) => {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ? true : ctx.mustBe('a flat generator id');
});

export const ColumnDefaultLiteralSchema = type.declare<ColumnDefaultLiteral>().type({
  kind: literalKindSchema,
  value: 'string | number | boolean | null | unknown[] | Record<string, unknown>',
});

export const ColumnDefaultFunctionSchema = type.declare<ColumnDefaultFunction>().type({
  kind: functionKindSchema,
  expression: 'string',
});

export const ColumnDefaultSchema = ColumnDefaultLiteralSchema.or(ColumnDefaultFunctionSchema);

const ExecutionMutationDefaultValueSchema = type({
  '+': 'reject',
  kind: generatorKindSchema,
  id: generatorIdSchema,
  'params?': 'Record<string, unknown>',
});

const ExecutionMutationDefaultSchema = type({
  '+': 'reject',
  ref: {
    '+': 'reject',
    table: 'string',
    column: 'string',
  },
  'onCreate?': ExecutionMutationDefaultValueSchema,
  'onUpdate?': ExecutionMutationDefaultValueSchema,
});

const ExecutionSchema = type({
  '+': 'reject',
  executionHash: 'string',
  mutations: {
    '+': 'reject',
    defaults: ExecutionMutationDefaultSchema.array().readonly(),
  },
});

const StorageColumnSchema = type({
  '+': 'reject',
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

export const IndexSchema = type({
  columns: type.string.array().readonly(),
  'name?': 'string',
  'using?': 'string',
  'config?': 'Record<string, unknown>',
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
  constraint: 'boolean',
  index: 'boolean',
});

const StorageTableSchema = type({
  '+': 'reject',
  columns: type({ '[string]': StorageColumnSchema }),
  'primaryKey?': PrimaryKeySchema,
  uniques: UniqueConstraintSchema.array().readonly(),
  indexes: IndexSchema.array().readonly(),
  foreignKeys: ForeignKeySchema.array().readonly(),
});

const StorageSchema = type({
  '+': 'reject',
  storageHash: 'string',
  tables: type({ '[string]': StorageTableSchema }),
  'types?': type({ '[string]': StorageTypeInstanceSchema }),
});

const ModelFieldSchema = type({
  'nullable?': 'boolean',
  'codecId?': 'string',
});

const ModelStorageFieldSchema = type({
  column: 'string',
  'codecId?': 'string',
  'nullable?': 'boolean',
});

const ModelStorageSchema = type({
  table: 'string',
  fields: type({ '[string]': ModelStorageFieldSchema }),
});

const ModelSchema = type({
  storage: ModelStorageSchema,
  'fields?': type({ '[string]': ModelFieldSchema }),
  'relations?': type({ '[string]': 'unknown' }),
  'discriminator?': 'unknown',
  'variants?': 'unknown',
  'base?': 'string',
  'owner?': 'string',
});

const ContractMetaSchema = type({
  '[string]': 'unknown',
});

const SqlContractSchema = type({
  '+': 'reject',
  'schemaVersion?': "'1'",
  target: 'string',
  targetFamily: "'sql'",
  'coreHash?': 'string',
  'profileHash?': 'string',
  '_generated?': 'Record<string, unknown>',
  'capabilities?': 'Record<string, Record<string, boolean>>',
  'extensionPacks?': 'Record<string, unknown>',
  'meta?': ContractMetaSchema,
  'sources?': 'Record<string, unknown>',
  'roots?': 'Record<string, string>',
  models: type({ '[string]': ModelSchema }),
  storage: StorageSchema,
  'execution?': ExecutionSchema,
});

// NOTE: StorageColumnSchema, StorageTableSchema, and StorageSchema use bare type()
// instead of type.declare<T>().type() because the ColumnDefault union's value field
// includes bigint | Date (runtime-only types after decoding) which cannot be expressed
// in Arktype's JSON validation DSL. The `as SqlStorage` cast in validateStorage() bridges
// the gap between the JSON-safe Arktype output and the runtime TypeScript type.
// See decodeContractDefaults() in validate.ts for the decoding step.

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
  return result as SqlStorage;
}

export function validateModel(value: unknown): unknown {
  const result = ModelSchema(value);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Model validation failed: ${messages}`);
  }
  return result;
}

/**
 * Validates the structural shape of a Contract using Arktype.
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
 * @throws ContractValidationError if the contract structure is invalid
 */
export function validateSqlContract<T extends Contract<SqlStorage>>(value: unknown): T {
  if (typeof value !== 'object' || value === null) {
    throw new ContractValidationError(
      'Contract structural validation failed: value must be an object',
      'structural',
    );
  }

  const rawValue = value as { targetFamily?: string };
  if (rawValue.targetFamily !== undefined && rawValue.targetFamily !== 'sql') {
    throw new ContractValidationError(
      `Unsupported target family: ${rawValue.targetFamily}`,
      'structural',
    );
  }

  const contractResult = SqlContractSchema(value);

  if (contractResult instanceof type.errors) {
    const messages = contractResult.map((p: { message: string }) => p.message).join('; ');
    throw new ContractValidationError(
      `Contract structural validation failed: ${messages}`,
      'structural',
    );
  }

  // Arktype's inferred output type differs from T due to exactOptionalPropertyTypes
  // and branded hash types — the runtime value is structurally compatible after validation
  return contractResult as unknown as T;
}

/**
 * Validates semantic constraints on SqlStorage that cannot be expressed in Arktype schemas.
 *
 * Returns an array of human-readable error strings. Empty array = valid.
 *
 * Currently checks:
 * - duplicate named primary key / unique / index / foreign key objects within a table
 * - duplicate unique, index, or foreign key declarations within a table
 * - `setNull` referential action on a non-nullable FK column (would fail at runtime)
 * - `setDefault` referential action on a non-nullable FK column without a DEFAULT (would fail at runtime)
 */
export function validateStorageSemantics(storage: SqlStorage): string[] {
  const errors: string[] = [];

  for (const [tableName, table] of Object.entries(storage.tables)) {
    const namedObjects = new Map<string, string[]>();
    const registerNamedObject = (kind: string, name: string | undefined) => {
      if (!name) return;
      namedObjects.set(name, [...(namedObjects.get(name) ?? []), kind]);
    };

    registerNamedObject('primary key', table.primaryKey?.name);
    for (const unique of table.uniques) {
      registerNamedObject('unique constraint', unique.name);
    }
    for (const index of table.indexes) {
      registerNamedObject('index', index.name);
    }
    for (const fk of table.foreignKeys) {
      registerNamedObject('foreign key', fk.name);
    }

    for (const [name, kinds] of namedObjects) {
      if (kinds.length > 1) {
        errors.push(
          `Table "${tableName}": named object "${name}" is declared multiple times (${kinds.join(', ')})`,
        );
      }
    }

    const seenUniqueDefinitions = new Set<string>();
    for (const unique of table.uniques) {
      const signature = JSON.stringify({ columns: unique.columns });
      if (seenUniqueDefinitions.has(signature)) {
        errors.push(
          `Table "${tableName}": duplicate unique constraint definition on columns [${unique.columns.join(', ')}]`,
        );
        continue;
      }
      seenUniqueDefinitions.add(signature);
    }

    const seenIndexDefinitions = new Set<string>();
    for (const index of table.indexes) {
      const signature = JSON.stringify({
        columns: index.columns,
        using: index.using ?? null,
        config: index.config ?? null,
      });
      if (seenIndexDefinitions.has(signature)) {
        errors.push(
          `Table "${tableName}": duplicate index definition on columns [${index.columns.join(', ')}]`,
        );
        continue;
      }
      seenIndexDefinitions.add(signature);
    }

    const seenForeignKeyDefinitions = new Set<string>();
    for (const fk of table.foreignKeys) {
      const signature = JSON.stringify({
        columns: fk.columns,
        references: fk.references,
        onDelete: fk.onDelete ?? null,
        onUpdate: fk.onUpdate ?? null,
        constraint: fk.constraint,
        index: fk.index,
      });
      if (seenForeignKeyDefinitions.has(signature)) {
        errors.push(
          `Table "${tableName}": duplicate foreign key definition on columns [${fk.columns.join(', ')}]`,
        );
        continue;
      }
      seenForeignKeyDefinitions.add(signature);
    }

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
