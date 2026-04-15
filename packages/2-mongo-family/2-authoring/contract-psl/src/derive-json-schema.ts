import type { ContractField, ContractValueObject } from '@prisma-next/contract/types';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { MongoStorageValidator } from '@prisma-next/mongo-contract';

function resolveBsonType(
  codecId: string,
  codecLookup: CodecLookup | undefined,
): string | undefined {
  const codec = codecLookup?.get(codecId);
  return codec?.targetTypes[0];
}

function fieldToBsonSchema(
  field: ContractField,
  valueObjects: Record<string, ContractValueObject> | undefined,
  codecLookup: CodecLookup | undefined,
): Record<string, unknown> | undefined {
  if (field.type.kind === 'scalar') {
    const bsonType = resolveBsonType(field.type.codecId, codecLookup);
    if (!bsonType) return undefined;

    if ('many' in field && field.many) {
      return { bsonType: 'array', items: { bsonType } };
    }

    if (field.nullable) {
      return { bsonType: ['null', bsonType] };
    }

    return { bsonType };
  }

  if (field.type.kind === 'valueObject') {
    const vo = valueObjects?.[field.type.name];
    if (!vo) return undefined;
    const voSchema = deriveObjectSchema(vo.fields, valueObjects, codecLookup);
    if ('many' in field && field.many) {
      return { bsonType: 'array', items: voSchema };
    }
    if (field.nullable) {
      return { oneOf: [{ bsonType: 'null' }, voSchema] };
    }
    return voSchema;
  }

  return undefined;
}

function deriveObjectSchema(
  fields: Record<string, ContractField>,
  valueObjects: Record<string, ContractValueObject> | undefined,
  codecLookup: CodecLookup | undefined,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [fieldName, field] of Object.entries(fields)) {
    const schema = fieldToBsonSchema(field, valueObjects, codecLookup);
    if (schema) {
      properties[fieldName] = schema;
      if (!field.nullable) {
        required.push(fieldName);
      }
    }
  }

  const result: Record<string, unknown> = {
    bsonType: 'object',
    properties,
  };
  if (required.length > 0) {
    result['required'] = required.sort();
  }
  return result;
}

export function deriveJsonSchema(
  fields: Record<string, ContractField>,
  valueObjects?: Record<string, ContractValueObject>,
  codecLookup?: CodecLookup,
): MongoStorageValidator {
  return {
    jsonSchema: deriveObjectSchema(fields, valueObjects, codecLookup),
    validationLevel: 'strict',
    validationAction: 'error',
  };
}

export interface PolymorphicVariant {
  readonly discriminatorValue: string;
  readonly fields: Record<string, ContractField>;
}

export function derivePolymorphicJsonSchema(
  baseFields: Record<string, ContractField>,
  discriminatorField: string,
  variants: readonly PolymorphicVariant[],
  valueObjects?: Record<string, ContractValueObject>,
  codecLookup?: CodecLookup,
): MongoStorageValidator {
  const baseSchema = deriveObjectSchema(baseFields, valueObjects, codecLookup);

  const oneOf: Record<string, unknown>[] = [];
  for (const variant of variants) {
    const variantOnlyFields: Record<string, ContractField> = {};
    for (const [name, field] of Object.entries(variant.fields)) {
      if (!(name in baseFields)) {
        variantOnlyFields[name] = field;
      }
    }

    if (Object.keys(variantOnlyFields).length === 0 && variants.length <= 1) continue;

    const entry: Record<string, unknown> = {
      properties: {
        [discriminatorField]: { enum: [variant.discriminatorValue] },
      },
    };

    const variantProperties: Record<string, unknown> = {};
    const variantRequired: string[] = [];
    for (const [name, field] of Object.entries(variantOnlyFields)) {
      const schema = fieldToBsonSchema(field, valueObjects, codecLookup);
      if (schema) {
        variantProperties[name] = schema;
        if (!field.nullable) {
          variantRequired.push(name);
        }
      }
    }

    if (Object.keys(variantProperties).length > 0) {
      (entry['properties'] as Record<string, unknown>) = {
        ...(entry['properties'] as Record<string, unknown>),
        ...variantProperties,
      };
    }
    if (variantRequired.length > 0) {
      entry['required'] = variantRequired.sort();
    }

    oneOf.push(entry);
  }

  const jsonSchema = { ...baseSchema };
  if (oneOf.length > 0) {
    jsonSchema['oneOf'] = oneOf;
  }

  return {
    jsonSchema,
    validationLevel: 'strict',
    validationAction: 'error',
  };
}
