import { z } from 'zod';

// Field types
export const FieldTypeSchema = z.enum(['Int', 'String', 'Boolean', 'DateTime', 'Float']);
export type FieldType = z.infer<typeof FieldTypeSchema>;

// Default values
export const DefaultValueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('autoincrement') }),
  z.object({ type: z.literal('now') }),
  z.object({ type: z.literal('literal'), value: z.string() }),
]);
export type DefaultValue = z.infer<typeof DefaultValueSchema>;

// Attributes
export const AttributeSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('id') }),
  z.object({ name: z.literal('unique') }),
  z.object({ name: z.literal('default'), value: DefaultValueSchema }),
]);
export type Attribute = z.infer<typeof AttributeSchema>;

// Field definition
export const FieldSchema = z.object({
  name: z.string(),
  type: FieldTypeSchema,
  attributes: z.array(AttributeSchema).default([]),
});
export type Field = z.infer<typeof FieldSchema>;

// Model definition
export const ModelSchema = z.object({
  name: z.string(),
  fields: z.array(FieldSchema),
});
export type Model = z.infer<typeof ModelSchema>;

// Complete schema
export const SchemaSchema = z.object({
  models: z.array(ModelSchema),
});
export type Schema = z.infer<typeof SchemaSchema>;

// Validation functions
export function validateSchema(data: unknown): Schema {
  return SchemaSchema.parse(data);
}

export function validateModel(data: unknown): Model {
  return ModelSchema.parse(data);
}

export function validateField(data: unknown): Field {
  return FieldSchema.parse(data);
}

