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
  indexes: z.array(z.any()).default([]),
  constraints: z.array(z.any()).default([]),
  capabilities: z.array(z.string()).default([]),
  meta: z
    .object({
      source: z.string().optional(),
    })
    .optional(),
});

export type Table = z.infer<typeof TableSchema>;

// Complete schema
export const SchemaSchema = z.object({
  target: z.literal('postgres'),
  contractHash: z.string().optional(),
  tables: z.record(z.string(), TableSchema),
});

export type Schema = z.infer<typeof SchemaSchema>;

// Validation functions
export function validateSchema(data: unknown): Schema {
  return SchemaSchema.parse(data);
}

export function validateTable(data: unknown): Table {
  return TableSchema.parse(data);
}

export function validateColumn(data: unknown): Column {
  return ColumnSchema.parse(data);
}
