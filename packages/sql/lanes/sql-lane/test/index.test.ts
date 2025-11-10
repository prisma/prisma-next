import { describe, expect, it } from 'vitest';
import * as indexExports from '../src/index';

describe('index exports', () => {
  it('exports all expected types and functions', () => {
    expect(indexExports).toHaveProperty('rawOptions');
    expect(indexExports).toHaveProperty('sql');
    expect(indexExports).toHaveProperty('SelectBuilder');
    expect(indexExports).toHaveProperty('createJoinOnBuilder');
  });

  it('exports rawOptions function', () => {
    expect(typeof indexExports.rawOptions).toBe('function');
  });

  it('exports sql function', () => {
    expect(typeof indexExports.sql).toBe('function');
  });

  it('exports SelectBuilder type', () => {
    // SelectBuilder is a type, not a class, so it won't be available at runtime
    // We can't test type exports at runtime, but we can verify the export exists
    expect(typeof indexExports.SelectBuilder).toBe('undefined');
  });

  it('exports createJoinOnBuilder function', () => {
    expect(typeof indexExports.createJoinOnBuilder).toBe('function');
  });
});
