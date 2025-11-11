import { describe, expect, it } from 'vitest';
import { OrmModelBuilderImpl, orm } from '../src/index';

describe('index exports', () => {
  it('exports orm function', () => {
    expect(typeof orm).toBe('function');
  });

  it('exports OrmModelBuilderImpl class', () => {
    expect(OrmModelBuilderImpl).toBeDefined();
    expect(typeof OrmModelBuilderImpl).toBe('function');
  });
});
