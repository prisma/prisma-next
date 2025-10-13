import { type } from 'arktype';

// PostgreSQL-specific column types
export const ColumnTypeSchema = type(
  "'int4' | 'int8' | 'text' | 'varchar' | 'bool' | 'timestamptz' | 'timestamp' | 'float8' | 'float4' | 'uuid' | 'json' | 'jsonb'",
);

export type ColumnType = typeof ColumnTypeSchema.infer;

// Default value kinds
export const DefaultValueSchema = type({
  kind: "'autoincrement'",
})
  .or({
    kind: "'now'",
  })
  .or({
    kind: "'literal'",
    value: 'string',
  });

export type DefaultValue = typeof DefaultValueSchema.infer;

// Primary key
export const PrimaryKeySchema = type({
  kind: "'primaryKey'",
  columns: 'string[]',
  'name?': 'string',
});

// Unique constraint
export const UniqueSchema = type({
  kind: "'unique'",
  columns: 'string[]',
  'name?': 'string',
});

// Foreign key
export const ForeignKeySchema = type({
  kind: "'foreignKey'",
  columns: 'string[]',
  references: {
    table: 'string',
    columns: 'string[]',
  },
  'name?': 'string',
  'onDelete?': "'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault'",
  'onUpdate?': "'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault'",
});

// Index
export const IndexSchema = type({
  'name?': 'string',
  columns: 'string[]',
  unique: 'boolean',
  'method?': "'btree' | 'hash' | 'gist' | 'gin'",
});

export const ConstraintSchema = PrimaryKeySchema.or(UniqueSchema).or(ForeignKeySchema);

export type PrimaryKey = typeof PrimaryKeySchema.infer;
export type Unique = typeof UniqueSchema.infer;
export type ForeignKey = typeof ForeignKeySchema.infer;
export type Index = typeof IndexSchema.infer;
export type Constraint = typeof ConstraintSchema.infer;

// Column definition
export const ColumnSchema = type({
  type: ColumnTypeSchema,
  nullable: 'boolean',
  'pk?': 'boolean',
  'unique?': 'boolean',
  'default?': DefaultValueSchema,
});

export type Column = typeof ColumnSchema.infer;

// Table definition with proper type specificity
export const TableSchema = type({
  columns: {
    '[string]': ColumnSchema,
  },
  'primaryKey?': PrimaryKeySchema,
  uniques: UniqueSchema.array(),
  foreignKeys: ForeignKeySchema.array(),
  indexes: IndexSchema.array(),
  'capabilities?': 'string[]', // Optional, defaults to empty array
  'meta?': {
    'source?': 'string',
  },
});

export type Table = typeof TableSchema.infer;

// Model field definition
export const ModelFieldSchema = type({
  type: 'string', // PSL type: 'Int', 'String', 'DateTime', etc.
  'isList?': 'boolean',
  'isOptional?': 'boolean',
  'mappedTo?': 'string', // column name in storage
  'isRelation?': 'boolean', // true for relation fields
  'relationTarget?': 'string', // target model name for relations
});

// Model storage mapping
export const ModelStorageSchema = type({
  kind: "'table' | 'view' | 'collection'",
  target: 'string', // table/view/collection name
});

// Model definition with proper type specificity
export const ModelSchema = type({
  name: 'string',
  storage: ModelStorageSchema,
  fields: {
    '[string]': ModelFieldSchema,
  },
  'meta?': {
    'source?': 'string',
    'comments?': 'string',
  },
});

export type ModelField = typeof ModelFieldSchema.infer;
export type ModelStorage = typeof ModelStorageSchema.infer;
export type Model = typeof ModelSchema.infer;

// Complete schema with proper type specificity
export const ContractSchema = type({
  target: "'postgres'",
  'contractHash?': 'string',
  tables: {
    '[string]': TableSchema,
  },
  'models?': {
    '[string]': ModelSchema,
  },
  'capabilities?': {
    'postgres?': {
      jsonAgg: 'boolean',
      lateral: 'boolean',
    },
  },
});

export type Schema = typeof ContractSchema.infer;

// Contract type structure for generated relations.d.ts
export interface Contract {
  Tables: Record<string, Record<string, any>>;
  Relations: Record<
    string,
    Record<
      string,
      {
        to: string;
        cardinality: '1:N' | 'N:1';
        on: { parentCols: string[]; childCols: string[] };
      }
    >
  >;
  Uniques: Record<string, string[]>;
}

// Validation functions
export function validateContract(data: unknown): Schema {
  const result = ContractSchema(data);
  if (result instanceof type.errors) {
    throw new Error(result.summary);
  }

  // ArkType now handles nested validation directly through index signatures
  return result as Schema;
}

export function validateTable(data: unknown): Table {
  const result = TableSchema(data);
  if (result instanceof type.errors) {
    throw new Error(result.summary);
  }

  // ArkType now handles nested validation directly through index signatures
  return result as Table;
}

export function validateColumn(data: unknown): Column {
  const result = ColumnSchema(data);
  if (result instanceof type.errors) {
    throw new Error(result.summary);
  }
  return result;
}

export function validateModel(data: unknown): Model {
  const result = ModelSchema(data);
  if (result instanceof type.errors) {
    throw new Error(result.summary);
  }

  // ArkType now handles nested validation directly through index signatures
  return result as Model;
}

export function validateModelMappings(schema: Schema): void {
  if (!schema.models) return;

  for (const [modelName, model] of Object.entries(schema.models)) {
    const modelObj = model as any;
    const targetTable = (schema.tables as any)[modelObj.storage.target];

    if (!targetTable) {
      throw new Error(
        `Model '${modelName}' references non-existent table '${modelObj.storage.target}'`,
      );
    }

    for (const [fieldName, field] of Object.entries(modelObj.fields)) {
      if ((field as any).isRelation) continue; // skip relation fields

      if ((field as any).mappedTo && !(targetTable.columns as any)[(field as any).mappedTo]) {
        throw new Error(
          `Model '${modelName}' field '${fieldName}' maps to non-existent column '${(field as any).mappedTo}' in table '${modelObj.storage.target}'`,
        );
      }
    }
  }
}
