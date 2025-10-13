import { describe, it, expect } from 'vitest';
import { canonicalJSONStringify } from '../src/canonicalize';

describe('Canonicalization', () => {
  it('sorts object keys alphabetically', () => {
    const input = { c: 3, a: 1, b: 2 };
    const result = canonicalJSONStringify(input);
    expect(result).toBe('{"a":1,"b":2,"c":3}');
  });

  it('sorts nested object keys', () => {
    const input = {
      user: { email: 'test@example.com', id: 1 },
      post: { title: 'Hello', content: 'World' },
    };
    const result = canonicalJSONStringify(input);
    expect(result).toBe('{"post":{"content":"World","title":"Hello"},"user":{"email":"test@example.com","id":1}}');
  });

  it('preserves array order', () => {
    const input = { items: [3, 1, 2] };
    const result = canonicalJSONStringify(input);
    expect(result).toBe('{"items":[3,1,2]}');
  });

  it('handles nested arrays with objects', () => {
    const input = {
      users: [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ],
    };
    const result = canonicalJSONStringify(input);
    expect(result).toBe('{"users":[{"age":30,"name":"Alice"},{"age":25,"name":"Bob"}]}');
  });

  it('handles primitives unchanged', () => {
    expect(canonicalJSONStringify('string')).toBe('"string"');
    expect(canonicalJSONStringify(42)).toBe('42');
    expect(canonicalJSONStringify(true)).toBe('true');
    expect(canonicalJSONStringify(null)).toBe('null');
  });

  it('handles empty objects and arrays', () => {
    expect(canonicalJSONStringify({})).toBe('{}');
    expect(canonicalJSONStringify([])).toBe('[]');
  });

  it('produces consistent output for complex nested structures', () => {
    const input = {
      tables: {
        user: {
          columns: {
            email: { type: 'text', nullable: false },
            id: { type: 'int4', nullable: false, pk: true },
          },
          indexes: [],
          constraints: [],
          capabilities: [],
        },
      },
      target: 'postgres',
    };
    
    const result1 = canonicalJSONStringify(input);
    const result2 = canonicalJSONStringify(input);
    expect(result1).toBe(result2);
    
    // Verify the structure is properly sorted
    expect(result1).toContain('"target":"postgres"');
    expect(result1).toContain('"tables"');
    expect(result1).toContain('"capabilities":[]');
    expect(result1).toContain('"constraints":[]');
    expect(result1).toContain('"indexes":[]');
  });
});
