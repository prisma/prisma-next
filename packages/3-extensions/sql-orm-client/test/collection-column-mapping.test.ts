import { describe, expect, it } from 'vitest';
import {
  mapCursorValuesToColumns,
  mapFieldsToColumns,
  mapFieldToColumn,
} from '../src/collection-column-mapping';
import { getTestContract } from './helpers';

describe('collection-column-mapping', () => {
  const contract = getTestContract();

  it('mapFieldToColumn() resolves known fields and falls back for unknown fields', () => {
    expect(mapFieldToColumn(contract, 'Post', 'userId')).toBe('user_id');
    expect(mapFieldToColumn(contract, 'Post', 'customField')).toBe('customField');
  });

  it('mapFieldsToColumns() maps arrays by model mapping when available', () => {
    expect(mapFieldsToColumns(contract, 'Post', ['id', 'userId', 'views'])).toEqual([
      'id',
      'user_id',
      'views',
    ]);
    expect(mapFieldsToColumns(contract, 'UnknownModel', ['id', 'customField'])).toEqual([
      'id',
      'customField',
    ]);
  });

  it('mapCursorValuesToColumns() skips undefined values and maps field names to columns', () => {
    expect(
      mapCursorValuesToColumns(contract, 'Post', {
        id: 1,
        userId: 2,
        views: undefined,
      }),
    ).toEqual({
      id: 1,
      user_id: 2,
    });
  });

  it('mapCursorValuesToColumns() falls back when model or field mapping is missing', () => {
    expect(
      mapCursorValuesToColumns(contract, 'UnknownModel', {
        custom: 1,
      }),
    ).toEqual({
      custom: 1,
    });

    expect(
      mapCursorValuesToColumns(contract, 'Post', {
        unknownField: 2,
      }),
    ).toEqual({
      unknownField: 2,
    });
  });
});
