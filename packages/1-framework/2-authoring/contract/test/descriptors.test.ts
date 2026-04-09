import { describe, expect, it } from 'vitest';
import type { ColumnTypeDescriptor, ForeignKeyDefaultsState, IndexDef } from '../src';

describe('descriptor exports', () => {
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

  it('keeps index defs as plain data', () => {
    const index: IndexDef = {
      columns: ['email'],
      name: 'user_email_idx',
      using: 'btree',
      config: { fillfactor: 90 },
    };

    expect(index).toEqual({
      columns: ['email'],
      name: 'user_email_idx',
      using: 'btree',
      config: { fillfactor: 90 },
    });
  });
});
