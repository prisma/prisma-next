import { describe, expect, it } from 'vitest';
import { renderTypeScriptTypeFromJsonSchema } from '../src/core/json-schema-type-expression';

describe('renderTypeScriptTypeFromJsonSchema', () => {
  describe('non-schema inputs', () => {
    it('returns JsonValue for null', () => {
      expect(renderTypeScriptTypeFromJsonSchema(null)).toBe('JsonValue');
    });

    it('returns JsonValue for undefined', () => {
      expect(renderTypeScriptTypeFromJsonSchema(undefined)).toBe('JsonValue');
    });

    it('returns JsonValue for a string', () => {
      expect(renderTypeScriptTypeFromJsonSchema('not a schema')).toBe('JsonValue');
    });

    it('returns JsonValue for a number', () => {
      expect(renderTypeScriptTypeFromJsonSchema(42)).toBe('JsonValue');
    });

    it('returns JsonValue for an empty object with no type', () => {
      expect(renderTypeScriptTypeFromJsonSchema({})).toBe('JsonValue');
    });
  });

  describe('primitive types', () => {
    it('renders string type', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ type: 'string' })).toBe('string');
    });

    it('renders number type', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ type: 'number' })).toBe('number');
    });

    it('renders integer as number', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ type: 'integer' })).toBe('number');
    });

    it('renders boolean type', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ type: 'boolean' })).toBe('boolean');
    });

    it('renders null type', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ type: 'null' })).toBe('null');
    });

    it('returns JsonValue for unknown type', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ type: 'unknown_type' })).toBe('JsonValue');
    });
  });

  describe('const values', () => {
    it('renders string const', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ const: 'hello' })).toBe("'hello'");
    });

    it('renders number const', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ const: 42 })).toBe('42');
    });

    it('renders boolean const', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ const: true })).toBe('true');
    });

    it('renders null const', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ const: null })).toBe('null');
    });

    it('renders unknown for object const', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ const: {} })).toBe('unknown');
    });

    it('escapes single quotes in string const', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ const: "it's" })).toBe("'it\\'s'");
    });

    it('escapes backslashes in string const', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ const: 'back\\slash' })).toBe("'back\\\\slash'");
    });

    it('escapes trailing backslash in string const', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ const: 'trail\\' })).toBe("'trail\\\\'");
    });

    it('escapes newlines in string const', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ const: 'line\nbreak' })).toBe("'line\\nbreak'");
    });

    it('escapes carriage returns in string const', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ const: 'cr\rreturn' })).toBe("'cr\\rreturn'");
    });
  });

  describe('enum values', () => {
    it('renders string enum', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ enum: ['a', 'b', 'c'] })).toBe("'a' | 'b' | 'c'");
    });

    it('renders mixed enum', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ enum: ['hello', 42, true, null] })).toBe(
        "'hello' | 42 | true | null",
      );
    });
  });

  describe('multi-type arrays', () => {
    it('renders string | null', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ type: ['string', 'null'] })).toBe(
        'string | null',
      );
    });

    it('renders number | string | boolean', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ type: ['number', 'string', 'boolean'] })).toBe(
        'number | string | boolean',
      );
    });
  });

  describe('union types', () => {
    it('renders oneOf as union', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          oneOf: [{ type: 'string' }, { type: 'number' }],
        }),
      ).toBe('string | number');
    });

    it('renders anyOf as union', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          anyOf: [{ type: 'boolean' }, { type: 'null' }],
        }),
      ).toBe('boolean | null');
    });
  });

  describe('intersection types (allOf)', () => {
    it('renders allOf as intersection', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          allOf: [
            { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
            { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
          ],
        }),
      ).toBe('{ a: string } & { b: number }');
    });
  });

  describe('array types', () => {
    it('renders typed array', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ type: 'array', items: { type: 'string' } })).toBe(
        'string[]',
      );
    });

    it('renders array without items as unknown[]', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ type: 'array' })).toBe('unknown[]');
    });

    it('renders tuple array (items as array)', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'array',
          items: [{ type: 'string' }, { type: 'number' }],
        }),
      ).toBe('readonly [string, number]');
    });

    it('renders array of union type with parentheses', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'array',
          items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        }),
      ).toBe('(string | number)[]');
    });

    it('renders array of intersection type with parentheses', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'array',
          items: {
            allOf: [
              { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
              { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
            ],
          },
        }),
      ).toBe('({ a: string } & { b: number })[]');
    });

    it('renders nested array', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'array',
          items: { type: 'array', items: { type: 'number' } },
        }),
      ).toBe('number[][]');
    });
  });

  describe('object types', () => {
    it('renders empty object as Record<string, unknown>', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ type: 'object' })).toBe(
        'Record<string, unknown>',
      );
    });

    it('renders empty object with additionalProperties true', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({ type: 'object', additionalProperties: true }),
      ).toBe('Record<string, unknown>');
    });

    it('renders empty object with typed additionalProperties', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'object',
          additionalProperties: { type: 'string' },
        }),
      ).toBe('Record<string, string>');
    });

    it('renders object with required properties', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name', 'age'],
        }),
      ).toBe('{ age: number; name: string }');
    });

    it('renders object with optional properties', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'object',
          properties: {
            name: { type: 'string' },
            bio: { type: 'string' },
          },
          required: ['name'],
        }),
      ).toBe('{ bio?: string; name: string }');
    });

    it('renders object with all optional properties', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'object',
          properties: {
            a: { type: 'string' },
            b: { type: 'number' },
          },
        }),
      ).toBe('{ a?: string; b?: number }');
    });

    it('sorts properties alphabetically', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'object',
          properties: {
            z: { type: 'string' },
            a: { type: 'number' },
            m: { type: 'boolean' },
          },
          required: ['z', 'a', 'm'],
        }),
      ).toBe('{ a: number; m: boolean; z: string }');
    });

    it('quotes non-identifier property keys', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'object',
          properties: {
            'my-key': { type: 'string' },
            valid_key: { type: 'number' },
          },
          required: ['my-key', 'valid_key'],
        }),
      ).toBe("{ 'my-key': string; valid_key: number }");
    });

    it('escapes backslashes in quoted property keys', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'object',
          properties: {
            'back\\slash': { type: 'string' },
          },
          required: ['back\\slash'],
        }),
      ).toBe("{ 'back\\\\slash': string }");
    });
  });

  describe('nested schemas', () => {
    it('renders nested object', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'object',
          properties: {
            address: {
              type: 'object',
              properties: {
                city: { type: 'string' },
              },
              required: ['city'],
            },
          },
          required: ['address'],
        }),
      ).toBe('{ address: { city: string } }');
    });

    it('renders object with array property', () => {
      expect(
        renderTypeScriptTypeFromJsonSchema({
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['tags'],
        }),
      ).toBe('{ tags: string[] }');
    });
  });

  describe('unsupported constructs degrade to JsonValue', () => {
    it('returns JsonValue for $ref', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ $ref: '#/definitions/Foo' })).toBe('JsonValue');
    });

    it('returns JsonValue for schema with no recognized keywords', () => {
      expect(renderTypeScriptTypeFromJsonSchema({ description: 'just a description' })).toBe(
        'JsonValue',
      );
    });
  });
});
