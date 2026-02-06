import { describe, expect, it } from 'vitest';
import { vectorColumn } from '../src/exports/column-types';

describe('sqlite-vector column-types', () => {
  it('vectorColumn has correct codecId and nativeType', () => {
    expect(vectorColumn).toMatchObject({
      codecId: 'sqlite/vector@1',
      nativeType: 'text',
    });
  });

  it('vectorColumn has no typeParams', () => {
    expect(vectorColumn).not.toHaveProperty('typeParams');
  });
});
