import { z } from 'zod';

// PostgreSQL-specific column types
export const ColumnTypeSchema = z.enum([
  'int4',
  'int8',
  'text',
  'varchar',
  'bool',
  'timestamptz',
  'timestamp',
  'float8',
  'float4',
  'uuid',
  'json',
  'jsonb',
]);

export type ColumnType = z.infer<typeof ColumnTypeSchema>;

// Default value kinds
export const DefaultValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('autoincrement') }),
  z.object({ kind: z.literal('now') }),
  z.object({ kind: z.literal('literal'), value: z.string() }),
]);

export type DefaultValue = z.infer<typeof DefaultValueSchema>;

// Primary key
export const PrimaryKeySchema = z.object({
  kind: z.literal('primaryKey'),
  columns: z.array(z.string()).min(1),
  name: z.string().optional(),
});

// Unique constraint
export const UniqueSchema = z.object({
  kind: z.literal('unique'),
  columns: z.array(z.string()).min(1),
  name: z.string().optional(),
});

// Foreign key
export const ForeignKeySchema = z.object({
  kind: z.literal('foreignKey'),
  columns: z.array(z.string()).min(1),
  references: z.object({
    table: z.string(),
    columns: z.array(z.string()).min(1),
  }),
  name: z.string().optional(),
  onDelete: z.enum(['noAction', 'restrict', 'cascade', 'setNull', 'setDefault']).optional(),
  onUpdate: z.enum(['noAction', 'restrict', 'cascade', 'setNull', 'setDefault']).optional(),
});

// Index
export const IndexSchema = z.object({
  name: z.string().optional(),
  columns: z.array(z.string()).min(1),
  unique: z.boolean().default(false),
  method: z.enum(['btree', 'hash', 'gist', 'gin']).optional(),
});

export const ConstraintSchema = z.discriminatedUnion('kind', [
  PrimaryKeySchema,
  UniqueSchema,
  ForeignKeySchema,
]);

export type PrimaryKey = z.infer<typeof PrimaryKeySchema>;
export type Unique = z.infer<typeof UniqueSchema>;
export type ForeignKey = z.infer<typeof ForeignKeySchema>;
export type Index = z.infer<typeof IndexSchema>;
export type Constraint = z.infer<typeof ConstraintSchema>;

// Column definition
export const ColumnSchema = z.object({
  type: ColumnTypeSchema,
  nullable: z.boolean(),
  pk: z.boolean().optional(),
  unique: z.boolean().optional(),
  default: DefaultValueSchema.optional(),
});

export type Column = z.infer<typeof ColumnSchema>;

// Table definition
export const TableSchema = z.object({
  columns: z.record(z.string(), ColumnSchema),
  primaryKey: PrimaryKeySchema.optional(),
  uniques: z.array(UniqueSchema).default([]),
  foreignKeys: z.array(ForeignKeySchema).default([]),
  indexes: z.array(IndexSchema).default([]),
  capabilities: z.array(z.string()).default([]),
  meta: z
    .object({
      source: z.string().optional(),
    })
    .optional(),
});

export type Table = z.infer<typeof TableSchema>;

// Model field definition
export const ModelFieldSchema = z.object({
  type: z.string(), // PSL type: 'Int', 'String', 'DateTime', etc.
  isList: z.boolean().optional(),
  isOptional: z.boolean().optional(),
  mappedTo: z.string().optional(), // column name in storage
  isRelation: z.boolean().optional(), // true for relation fields
  relationTarget: z.string().optional(), // target model name for relations
});

// Model storage mapping
export const ModelStorageSchema = z.object({
  kind: z.enum(['table', 'view', 'collection']),
  target: z.string(), // table/view/collection name
});

// Model definition
export const ModelSchema = z.object({
  name: z.string(),
  storage: ModelStorageSchema,
  fields: z.record(z.string(), ModelFieldSchema),
  meta: z
    .object({
      source: z.string().optional(),
      comments: z.string().optional(),
    })
    .optional(),
});

export type ModelField = z.infer<typeof ModelFieldSchema>;
export type ModelStorage = z.infer<typeof ModelStorageSchema>;
export type Model = z.infer<typeof ModelSchema>;

// Complete schema
export const ContractSchema = z.object({
  target: z.literal('postgres'),
  contractHash: z.string().optional(),
  tables: z.record(z.string(), TableSchema),
  models: z.record(z.string(), ModelSchema).optional(), // additive
  capabilities: z
    .object({
      postgres: z
        .object({
          jsonAgg: z.boolean().default(true),
          lateral: z.boolean().default(true),
        })
        .optional(),
    })
    .optional(),
});

export type Schema = z.infer<typeof ContractSchema>;

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
  return ContractSchema.parse(data);
}

export function validateTable(data: unknown): Table {
  return TableSchema.parse(data);
}

export function validateColumn(data: unknown): Column {
  return ColumnSchema.parse(data);
}

export function validateModelMappings(schema: Schema): void {
  if (!schema.models) return;

  for (const [modelName, model] of Object.entries(schema.models)) {
    const targetTable = schema.tables[model.storage.target];

    if (!targetTable) {
      throw new Error(
        `Model '${modelName}' references non-existent table '${model.storage.target}'`,
      );
    }

    for (const [fieldName, field] of Object.entries(model.fields)) {
      if (field.isRelation) continue; // skip relation fields

      if (field.mappedTo && !targetTable.columns[field.mappedTo]) {
        throw new Error(
          `Model '${modelName}' field '${fieldName}' maps to non-existent column '${field.mappedTo}' in table '${model.storage.target}'`,
        );
      }
    }
  }
}
