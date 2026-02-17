import { describe, expect, it } from 'vitest';
import {
  extractStandardSchemaOutputJsonSchema,
  extractStandardSchemaTypeExpression,
  isStandardSchemaLike,
  type StandardSchemaLike,
} from '../src/core/standard-schema';

describe('standard-schema', () => {
  describe('isStandardSchemaLike', () => {
    it('returns true for object with ~standard object', () => {
      expect(isStandardSchemaLike({ '~standard': {} })).toBe(true);
    });

    it('returns true for object with ~standard containing fields', () => {
      expect(
        isStandardSchemaLike({
          '~standard': { version: 1, jsonSchema: { output: {} } },
        }),
      ).toBe(true);
    });

    it('returns false for null', () => {
      expect(isStandardSchemaLike(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isStandardSchemaLike(undefined)).toBe(false);
    });

    it('returns false for string', () => {
      expect(isStandardSchemaLike('not a schema')).toBe(false);
    });

    it('returns false for number', () => {
      expect(isStandardSchemaLike(42)).toBe(false);
    });

    it('returns false for object without ~standard', () => {
      expect(isStandardSchemaLike({ foo: 'bar' })).toBe(false);
    });

    it('returns false for object where ~standard is not an object', () => {
      expect(isStandardSchemaLike({ '~standard': 'string' })).toBe(false);
    });

    it('returns false for object where ~standard is null', () => {
      expect(isStandardSchemaLike({ '~standard': null })).toBe(false);
    });

    it('returns true for function with ~standard', () => {
      const fn = () => {};
      (fn as unknown as Record<string, unknown>)['~standard'] = {};
      expect(isStandardSchemaLike(fn)).toBe(true);
    });
  });

  describe('extractStandardSchemaOutputJsonSchema', () => {
    it('returns undefined when ~standard is missing', () => {
      const schema: StandardSchemaLike = {};
      expect(extractStandardSchemaOutputJsonSchema(schema)).toBeUndefined();
    });

    it('returns undefined when jsonSchema is missing', () => {
      const schema: StandardSchemaLike = { '~standard': {} };
      expect(extractStandardSchemaOutputJsonSchema(schema)).toBeUndefined();
    });

    it('returns undefined when jsonSchema.output is undefined', () => {
      const schema: StandardSchemaLike = {
        '~standard': { jsonSchema: {} },
      };
      expect(extractStandardSchemaOutputJsonSchema(schema)).toBeUndefined();
    });

    it('returns undefined when jsonSchema.output is a primitive', () => {
      const schema: StandardSchemaLike = {
        '~standard': { jsonSchema: { output: 'not an object' } },
      };
      expect(extractStandardSchemaOutputJsonSchema(schema)).toBeUndefined();
    });

    it('returns undefined when jsonSchema.output is null', () => {
      const schema: StandardSchemaLike = {
        '~standard': { jsonSchema: { output: null } },
      };
      expect(extractStandardSchemaOutputJsonSchema(schema)).toBeUndefined();
    });

    it('returns the static output object when present', () => {
      const outputSchema = { type: 'object', properties: { name: { type: 'string' } } };
      const schema: StandardSchemaLike = {
        '~standard': { jsonSchema: { output: outputSchema } },
      };
      expect(extractStandardSchemaOutputJsonSchema(schema)).toBe(outputSchema);
    });

    it('calls output() function when output is a function', () => {
      const outputSchema = { type: 'object', properties: { id: { type: 'number' } } };
      const schema: StandardSchemaLike = {
        '~standard': {
          jsonSchema: {
            output: (options: { target: string }) => {
              expect(options.target).toBe('draft-07');
              return outputSchema;
            },
          },
        },
      };
      expect(extractStandardSchemaOutputJsonSchema(schema)).toBe(outputSchema);
    });

    it('returns undefined when output function returns a primitive', () => {
      const schema: StandardSchemaLike = {
        '~standard': {
          jsonSchema: {
            output: () => 'not an object',
          },
        },
      };
      expect(extractStandardSchemaOutputJsonSchema(schema)).toBeUndefined();
    });
  });

  describe('extractStandardSchemaTypeExpression', () => {
    it('returns undefined when expression is missing', () => {
      const schema: StandardSchemaLike = { '~standard': {} };
      expect(extractStandardSchemaTypeExpression(schema)).toBeUndefined();
    });

    it('returns undefined when expression is not a string', () => {
      const schema: StandardSchemaLike = { '~standard': {}, expression: 42 };
      expect(extractStandardSchemaTypeExpression(schema)).toBeUndefined();
    });

    it('returns undefined when expression is null', () => {
      const schema: StandardSchemaLike = { '~standard': {}, expression: null };
      expect(extractStandardSchemaTypeExpression(schema)).toBeUndefined();
    });

    it('returns undefined when expression is empty string', () => {
      const schema: StandardSchemaLike = { '~standard': {}, expression: '' };
      expect(extractStandardSchemaTypeExpression(schema)).toBeUndefined();
    });

    it('returns undefined when expression is whitespace only', () => {
      const schema: StandardSchemaLike = { '~standard': {}, expression: '   ' };
      expect(extractStandardSchemaTypeExpression(schema)).toBeUndefined();
    });

    it('returns trimmed expression string', () => {
      const schema: StandardSchemaLike = {
        '~standard': {},
        expression: '  { name: string }  ',
      };
      expect(extractStandardSchemaTypeExpression(schema)).toBe('{ name: string }');
    });

    it('returns expression without trimming needed', () => {
      const schema: StandardSchemaLike = {
        '~standard': {},
        expression: '{ id: number }',
      };
      expect(extractStandardSchemaTypeExpression(schema)).toBe('{ id: number }');
    });
  });
});
