import { describe, expect, it } from 'vitest';
import * as indexExports from '../src/index';

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

  it('exports SelectBuilder', () => {
    // SelectBuilder is exported as a value (function/class), not just a type
    expect(indexExports).toHaveProperty('SelectBuilder');
  });

  it('exports createJoinOnBuilder function', () => {
    expect(typeof indexExports.createJoinOnBuilder).toBe('function');
  });
});
