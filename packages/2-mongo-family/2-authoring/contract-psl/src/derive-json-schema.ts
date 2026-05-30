import type { ContractField, ContractValueObject } from '@prisma-next/contract/types';
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
    // Closed by default: documents carrying fields not declared in `properties`
    // are rejected at every level (top-level collections and nested value objects).
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
): MongoValidator {
  return new MongoValidator({
    jsonSchema: deriveObjectSchema(fields, valueObjects, codecLookup),
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
): MongoValidator {
  const baseSchema = deriveObjectSchema(baseFields, valueObjects, codecLookup);
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
      const schema = fieldToBsonSchema(field, valueObjects, codecLookup);
      if (schema) {
        variantProperties[name] = schema;
        if (!field.nullable) {
          variantRequired.push(name);
        }
      }
    }

    // `additionalProperties: false` only sees the `properties` of the schema
    // object it sits on — it does not look into sibling `oneOf` branches. Each
    // branch is validated independently, so a closed branch must list the base
    // properties too; otherwise it would reject the base fields. The
    // discriminator is constrained to this variant's value.
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

  // The top-level schema stays open: closure is enforced by the closed branches.
  // Keeping `additionalProperties: false` here would reject every variant-only
  // field, since the top-level `properties` only lists base fields.
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
