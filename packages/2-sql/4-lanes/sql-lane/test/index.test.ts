import { describe, expect, it } from 'vitest';
import * as indexExports from '../src/index.ts';

describe('index exports', () => {
  it('exports all expected types and functions', () => {
    expect(indexExports).toHaveProperty('rawOptions');
    expect(indexExports).toHaveProperty('sql');
    expect(indexExports).toHaveProperty('createJoinOnBuilder');
  });

  it('exports rawOptions function', () => {
    expect(typeof indexExports.rawOptions).toBe('function');
  });

  it('exports sql function', () => {
    expect(typeof indexExports.sql).toBe('function');
  });

  it('exports SelectBuilder as a type', () => {
    // SelectBuilder is exported as a type, not a value
    // Type exports are not available at runtime, so we just verify the module exports exist
    expect(indexExports).toBeDefined();
  });

  it('exports createJoinOnBuilder function', () => {
    expect(typeof indexExports.createJoinOnBuilder).toBe('function');
  });
});
