import { describe, expect, it } from 'vitest';
import {
  compileJsonSchemaValidator,
  formatValidationErrors,
} from '../src/core/json-schema-validator';

describe('json-schema-validator', () => {
  describe('compileJsonSchemaValidator', () => {
    it('validates a simple object schema', () => {
      const validate = compileJsonSchemaValidator({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      });

      expect(validate({ name: 'Alice', age: 30 })).toEqual({ valid: true });
      expect(validate({ name: 'Bob' })).toEqual({ valid: true });
    });

    it('rejects values missing required properties', () => {
      const validate = compileJsonSchemaValidator({
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      });

      const result = validate({ age: 30 });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]!.keyword).toBe('required');
      }
    });

    it('rejects values with wrong types', () => {
      const validate = compileJsonSchemaValidator({
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      });

      const result = validate({ name: 42 });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.keyword).toBe('type');
        expect(result.errors[0]!.path).toBe('/name');
      }
    });

    it('validates nested objects', () => {
      const validate = compileJsonSchemaValidator({
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: {
              city: { type: 'string' },
              zip: { type: 'string' },
            },
            required: ['city'],
          },
        },
        required: ['address'],
      });

      expect(validate({ address: { city: 'NYC', zip: '10001' } })).toEqual({ valid: true });

      const result = validate({ address: { zip: '10001' } });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.path).toBe('/address');
        expect(result.errors[0]!.keyword).toBe('required');
      }
    });

    it('validates arrays', () => {
      const validate = compileJsonSchemaValidator({
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      });

      expect(validate({ tags: ['a', 'b', 'c'] })).toEqual({ valid: true });

      const result = validate({ tags: ['a', 42] });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.path).toBe('/tags/1');
      }
    });

    it('validates enum values', () => {
      const validate = compileJsonSchemaValidator({
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      });

      expect(validate({ status: 'active' })).toEqual({ valid: true });

      const result = validate({ status: 'pending' });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.keyword).toBe('enum');
      }
    });

    it('validates primitive root types', () => {
      const validate = compileJsonSchemaValidator({ type: 'string' });

      expect(validate('hello')).toEqual({ valid: true });

      const result = validate(42);
      expect(result.valid).toBe(false);
    });

    it('collects all errors with allErrors mode', () => {
      const validate = compileJsonSchemaValidator({
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['name', 'email'],
      });

      const result = validate({});
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBe(2);
      }
    });

    it('accepts any value when schema is empty object', () => {
      const validate = compileJsonSchemaValidator({});

      expect(validate({ anything: 'goes' })).toEqual({ valid: true });
      expect(validate('string')).toEqual({ valid: true });
      expect(validate(42)).toEqual({ valid: true });
      expect(validate(null)).toEqual({ valid: true });
    });
  });

  describe('formatValidationErrors', () => {
    it('formats a single root-level error', () => {
      const result = formatValidationErrors([
        { path: '/', message: 'must be object', keyword: 'type' },
      ]);
      expect(result).toBe('must be object');
    });

    it('formats a single nested error', () => {
      const result = formatValidationErrors([
        { path: '/name', message: 'must be string', keyword: 'type' },
      ]);
      expect(result).toBe('/name: must be string');
    });

    it('formats multiple errors', () => {
      const result = formatValidationErrors([
        { path: '/', message: "must have required property 'name'", keyword: 'required' },
        { path: '/age', message: 'must be number', keyword: 'type' },
      ]);
      expect(result).toBe("must have required property 'name'; /age: must be number");
    });

    it('returns fallback for empty errors', () => {
      expect(formatValidationErrors([])).toBe('unknown validation error');
    });
  });
});
