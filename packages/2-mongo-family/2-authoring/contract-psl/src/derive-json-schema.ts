import type { ContractField, ContractValueObject } from '@prisma-next/contract/types';
import type { MongoStorageValidator } from '@prisma-next/mongo-contract';

const CODEC_TO_BSON_TYPE: Record<string, string> = {
  'mongo/string@1': 'string',
  'mongo/int32@1': 'int',
  'mongo/bool@1': 'bool',
  'mongo/date@1': 'date',
  'mongo/objectId@1': 'objectId',
};

function fieldToBsonSchema(
  field: ContractField,
  valueObjects: Record<string, ContractValueObject> | undefined,
): Record<string, unknown> | undefined {
  if (field.type.kind === 'scalar') {
    const bsonType = CODEC_TO_BSON_TYPE[field.type.codecId];
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
    const voSchema = deriveObjectSchema(vo.fields, valueObjects);
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
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [fieldName, field] of Object.entries(fields)) {
    const schema = fieldToBsonSchema(field, valueObjects);
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
): MongoStorageValidator {
  return {
    jsonSchema: deriveObjectSchema(fields, valueObjects),
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
): MongoStorageValidator {
  const baseSchema = deriveObjectSchema(baseFields, valueObjects);

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
      const schema = fieldToBsonSchema(field, valueObjects);
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
