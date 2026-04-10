import type { ContractField, ContractValueObject } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { deriveJsonSchema } from '../src/derive-json-schema';

function scalarField(codecId: string, nullable = false): ContractField {
  return { type: { kind: 'scalar', codecId }, nullable };
}

function arrayField(codecId: string, nullable = false): ContractField {
  return { type: { kind: 'scalar', codecId }, nullable, many: true };
}

function voField(name: string, nullable = false): ContractField {
  return { type: { kind: 'valueObject', name }, nullable };
}

function voArrayField(name: string, nullable = false): ContractField {
  return { type: { kind: 'valueObject', name }, nullable, many: true };
}

describe('deriveJsonSchema', () => {
  it('maps String, Int, Boolean, DateTime, ObjectId to correct BSON types', () => {
    const result = deriveJsonSchema({
      name: scalarField('mongo/string@1'),
      age: scalarField('mongo/int32@1'),
      active: scalarField('mongo/bool@1'),
      created: scalarField('mongo/date@1'),
      _id: scalarField('mongo/objectId@1'),
    });

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['_id', 'active', 'age', 'created', 'name'],
      properties: {
        name: { bsonType: 'string' },
        age: { bsonType: 'int' },
        active: { bsonType: 'bool' },
        created: { bsonType: 'date' },
        _id: { bsonType: 'objectId' },
      },
    });
    expect(result.validationLevel).toBe('strict');
    expect(result.validationAction).toBe('error');
  });

  it('handles nullable field with bsonType array including null', () => {
    const result = deriveJsonSchema({
      email: scalarField('mongo/string@1', true),
    });

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      properties: {
        email: { bsonType: ['null', 'string'] },
      },
    });
  });

  it('handles array field (many: true)', () => {
    const result = deriveJsonSchema({
      tags: arrayField('mongo/string@1'),
    });

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['tags'],
      properties: {
        tags: { bsonType: 'array', items: { bsonType: 'string' } },
      },
    });
  });

  it('handles nullable array field', () => {
    const result = deriveJsonSchema({
      tags: arrayField('mongo/string@1', true),
    });

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      properties: {
        tags: { bsonType: 'array', items: { bsonType: 'string' } },
      },
    });
  });

  it('handles value object field as nested object', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Address: {
        fields: {
          street: scalarField('mongo/string@1'),
          city: scalarField('mongo/string@1'),
          zip: scalarField('mongo/string@1', true),
        },
      },
    };

    const result = deriveJsonSchema({ address: voField('Address') }, valueObjects);

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['address'],
      properties: {
        address: {
          bsonType: 'object',
          required: ['city', 'street'],
          properties: {
            street: { bsonType: 'string' },
            city: { bsonType: 'string' },
            zip: { bsonType: ['null', 'string'] },
          },
        },
      },
    });
  });

  it('handles value object array field', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Tag: {
        fields: {
          label: scalarField('mongo/string@1'),
        },
      },
    };

    const result = deriveJsonSchema({ tags: voArrayField('Tag') }, valueObjects);

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['tags'],
      properties: {
        tags: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['label'],
            properties: {
              label: { bsonType: 'string' },
            },
          },
        },
      },
    });
  });

  it('derives minimal schema from empty model', () => {
    const result = deriveJsonSchema({});

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      properties: {},
    });
  });

  it('handles mixed nullable and non-nullable fields', () => {
    const result = deriveJsonSchema({
      name: scalarField('mongo/string@1'),
      bio: scalarField('mongo/string@1', true),
      age: scalarField('mongo/int32@1'),
    });

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['age', 'name'],
      properties: {
        name: { bsonType: 'string' },
        bio: { bsonType: ['null', 'string'] },
        age: { bsonType: 'int' },
      },
    });
  });

  it('skips fields with unknown codec IDs', () => {
    const result = deriveJsonSchema({
      name: scalarField('mongo/string@1'),
      custom: scalarField('custom/unknown@1'),
    });

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['name'],
      properties: {
        name: { bsonType: 'string' },
      },
    });
  });

  it('handles nested value objects (recursive)', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Geo: {
        fields: {
          lat: scalarField('mongo/int32@1'),
          lng: scalarField('mongo/int32@1'),
        },
      },
      Address: {
        fields: {
          city: scalarField('mongo/string@1'),
          geo: voField('Geo'),
        },
      },
    };

    const result = deriveJsonSchema({ address: voField('Address') }, valueObjects);

    expect(result.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['address'],
      properties: {
        address: {
          bsonType: 'object',
          required: ['city', 'geo'],
          properties: {
            city: { bsonType: 'string' },
            geo: {
              bsonType: 'object',
              required: ['lat', 'lng'],
              properties: {
                lat: { bsonType: 'int' },
                lng: { bsonType: 'int' },
              },
            },
          },
        },
      },
    });
  });
});
