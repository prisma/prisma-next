import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';
import { PG_ARRAY_CODEC_ID, PG_INT4_CODEC_ID, PG_TIMESTAMP_CODEC_ID } from '../src/core/codec-ids';
import {
  int4Column,
  json,
  jsonb,
  jsonbColumn,
  jsonColumn,
  listOf,
  numericColumn,
  textColumn,
  timestampColumn,
} from '../src/exports/column-types';

describe('adapter-postgres column-types', () => {
  describe('jsonColumn', () => {
    it('has expected codec and native type', () => {
      expect(jsonColumn).toMatchObject({
        codecId: 'pg/json@1',
        nativeType: 'json',
      });
    });
  });

  describe('jsonbColumn', () => {
    it('has expected codec and native type', () => {
      expect(jsonbColumn).toMatchObject({
        codecId: 'pg/jsonb@1',
        nativeType: 'jsonb',
      });
    });
  });

  describe('json()', () => {
    it('returns static descriptor when no schema is provided', () => {
      expect(json()).toEqual(jsonColumn);
    });

    it('attaches standard-schema output in typeParams.schemaJson', () => {
      const descriptor = json(
        arktype({
          action: 'string',
          actorId: 'number',
        }),
      );
      expect(descriptor).toMatchObject({
        codecId: 'pg/json@1',
        nativeType: 'json',
        typeParams: {
          schemaJson: expect.objectContaining({
            type: 'object',
          }),
        },
      });
    });

    it('does not have a runtime schema key in typeParams', () => {
      const descriptor = json(
        arktype({
          action: 'string',
          actorId: 'number',
        }),
      );
      expect(descriptor.typeParams).not.toHaveProperty('schema');
    });
  });

  describe('jsonb()', () => {
    it('returns static descriptor when no schema is provided', () => {
      expect(jsonb()).toEqual(jsonbColumn);
    });

    it('attaches standard-schema output in typeParams.schemaJson', () => {
      const descriptor = jsonb(
        arktype({
          source: 'string',
          rank: 'number',
        }),
      );
      expect(descriptor).toMatchObject({
        codecId: 'pg/jsonb@1',
        nativeType: 'jsonb',
        typeParams: {
          schemaJson: expect.objectContaining({
            type: 'object',
          }),
        },
      });
    });

    it('does not have a runtime schema key in typeParams', () => {
      const descriptor = jsonb(
        arktype({
          source: 'string',
          rank: 'number',
        }),
      );
      expect(descriptor.typeParams).not.toHaveProperty('schema');
    });
  });

  describe('error paths', () => {
    it('throws when schema lacks ~standard.jsonSchema.output', () => {
      const badSchema = { '~standard': {} } as never;
      expect(() => jsonb(badSchema)).toThrow(
        'JSON schema must expose ~standard.jsonSchema.output()',
      );
    });

    it('throws when schema is not a Standard Schema value', () => {
      const notASchema = { foo: 'bar' } as never;
      expect(() => jsonb(notASchema)).toThrow('jsonb(schema) expects a Standard Schema value');
    });

    it('throws for json() with invalid schema', () => {
      const notASchema = { foo: 'bar' } as never;
      expect(() => json(notASchema)).toThrow('json(schema) expects a Standard Schema value');
    });
  });
});

describe('listOf', () => {
  it('wraps a simple scalar column descriptor', () => {
    const result = listOf(int4Column);

    expect(result.codecId).toBe(PG_ARRAY_CODEC_ID);
    expect(result.nativeType).toBe('int4[]');
    expect(result.typeParams).toEqual({
      element: { codecId: PG_INT4_CODEC_ID, nativeType: 'int4' },
    });
  });

  it('wraps a text column', () => {
    const result = listOf(textColumn);

    expect(result.codecId).toBe(PG_ARRAY_CODEC_ID);
    expect(result.nativeType).toBe('text[]');
    expect((result.typeParams?.['element'] as { codecId: string }).codecId).toBe('pg/text@1');
  });

  it('includes nullableElement when specified', () => {
    const result = listOf(int4Column, { nullableElement: true });

    expect(result.typeParams).toEqual({
      element: { codecId: PG_INT4_CODEC_ID, nativeType: 'int4' },
      nullableElement: true,
    });
  });

  it('omits nullableElement when false', () => {
    const result = listOf(int4Column, { nullableElement: false });

    expect(result.typeParams).toEqual({
      element: { codecId: PG_INT4_CODEC_ID, nativeType: 'int4' },
    });
  });

  it('omits nullableElement when options not provided', () => {
    const result = listOf(int4Column);

    expect(result.typeParams).not.toHaveProperty('nullableElement');
  });

  it('wraps a timestamp column', () => {
    const result = listOf(timestampColumn);

    expect(result.codecId).toBe(PG_ARRAY_CODEC_ID);
    expect(result.nativeType).toBe('timestamp[]');
    expect((result.typeParams?.['element'] as { codecId: string }).codecId).toBe(
      PG_TIMESTAMP_CODEC_ID,
    );
  });

  it('forwards element typeParams for parameterized element types', () => {
    const numeric = numericColumn(10, 2);
    const result = listOf(numeric);

    expect(result.typeParams).toEqual({
      element: {
        codecId: 'pg/numeric@1',
        nativeType: 'numeric',
        typeParams: { precision: 10, scale: 2 },
      },
    });
  });

  it('omits element typeParams when element has none', () => {
    const result = listOf(int4Column);
    const element = result.typeParams?.['element'] as Record<string, unknown>;

    expect(element).not.toHaveProperty('typeParams');
  });
});
