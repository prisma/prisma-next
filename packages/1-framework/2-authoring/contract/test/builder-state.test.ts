import { describe, expect, it } from 'vitest';
import type { ColumnTypeDescriptor, ForeignKeyDefaultsState } from '../src';

describe('builder-state exports', () => {
  it('keeps column descriptors as plain data', () => {
    const descriptor: ColumnTypeDescriptor = {
      codecId: 'pg/text@1',
      nativeType: 'text',
    };

    expect(descriptor).toEqual({
      codecId: 'pg/text@1',
      nativeType: 'text',
    });
  });

  it('keeps foreign key defaults as plain data', () => {
    const defaults: ForeignKeyDefaultsState = {
      constraint: true,
      index: false,
    };

    expect(defaults).toEqual({
      constraint: true,
      index: false,
    });
  });
});
