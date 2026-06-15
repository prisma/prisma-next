import type { ContractEnum, ContractField, ContractValueObject } from '@prisma-next/contract/types';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { MongoValidator } from '@prisma-next/mongo-contract';

function resolveBsonType(
  codecId: string,
  codecLookup: CodecLookup | undefined,
): string | undefined {
  return codecLookup?.targetTypesFor(codecId)?.[0];
}

function fieldToBsonSchema(
  field: ContractField,
  valueObjects: Record<string, ContractValueObject> | undefined,
  codecLookup: CodecLookup | undefined,
  enums: Record<string, ContractEnum> | undefined,
): Record<string, unknown> | undefined {
  if (field.type.kind === 'scalar') {
    const bsonType = resolveBsonType(field.type.codecId, codecLookup);
    if (!bsonType) return undefined;

    const enumValues =
      field.valueSet?.entityKind === 'enum'
        ? (enums?.[field.valueSet.entityName]?.members.map((m) => m.value) ?? null)
        : null;

    if ('many' in field && field.many) {
      const items: Record<string, unknown> = { bsonType };
      if (enumValues) items['enum'] = enumValues;
      return { bsonType: 'array', items };
    }

    if (field.nullable) {
      const s: Record<string, unknown> = { bsonType: ['null', bsonType] };
      if (enumValues) s['enum'] = [...enumValues, null];
      return s;
    }

    const s: Record<string, unknown> = { bsonType };
    if (enumValues) s['enum'] = enumValues;
    return s;
  }

  if (field.type.kind === 'valueObject') {
    const vo = valueObjects?.[field.type.name];
    if (!vo) return undefined;
    const voSchema = deriveObjectSchema(vo.fields, valueObjects, codecLookup, enums);
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
  enums: Record<string, ContractEnum> | undefined,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [fieldName, field] of Object.entries(fields)) {
    const schema = fieldToBsonSchema(field, valueObjects, codecLookup, enums);
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
    additionalProperties: false,
  };
  if (required.length > 0) {
    result['required'] = required.sort();
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deriveJsonSchema(
  fields: Record<string, ContractField>,
  valueObjects?: Record<string, ContractValueObject>,
  codecLookup?: CodecLookup,
  enums?: Record<string, ContractEnum>,
): MongoValidator {
  return new MongoValidator({
    jsonSchema: deriveObjectSchema(fields, valueObjects, codecLookup, enums),
    validationLevel: 'strict',
    validationAction: 'error',
  });
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
  enums?: Record<string, ContractEnum>,
): MongoValidator {
  const baseSchema = deriveObjectSchema(baseFields, valueObjects, codecLookup, enums);
  const baseProperties = isRecord(baseSchema['properties']) ? baseSchema['properties'] : {};

  const oneOf: Record<string, unknown>[] = [];
  for (const variant of variants) {
    const variantOnlyFields: Record<string, ContractField> = {};
    for (const [name, field] of Object.entries(variant.fields)) {
      if (!(name in baseFields)) {
        variantOnlyFields[name] = field;
      }
    }

    const variantProperties: Record<string, unknown> = {};
    const variantRequired: string[] = [discriminatorField];
    for (const [name, field] of Object.entries(variantOnlyFields)) {
      const schema = fieldToBsonSchema(field, valueObjects, codecLookup, enums);
      if (schema) {
        variantProperties[name] = schema;
        if (!field.nullable) {
          variantRequired.push(name);
        }
      }
    }

    const entry: Record<string, unknown> = {
      properties: {
        ...baseProperties,
        [discriminatorField]: { enum: [variant.discriminatorValue] },
        ...variantProperties,
      },
      required: variantRequired.sort(),
      additionalProperties: false,
    };

    oneOf.push(entry);
  }

  const jsonSchema = { ...baseSchema };
  delete jsonSchema['additionalProperties'];
  if (oneOf.length > 0) {
    jsonSchema['oneOf'] = oneOf;
  }

  return new MongoValidator({
    jsonSchema,
    validationLevel: 'strict',
    validationAction: 'error',
  });
}
