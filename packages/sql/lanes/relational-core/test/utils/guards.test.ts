import type { StorageColumn } from '@prisma-next/sql-contract/types';
import { int4Column as int4ColumnType } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { param } from '../../src/param';
import { ColumnBuilderImpl } from '../../src/schema';
import { getColumnMeta, isParamPlaceholder } from '../../src/utils/guards';

describe('guards', () => {
  const columnMeta: StorageColumn = {
    ...int4ColumnType,
    nullable: false,
  };

  describe('getColumnMeta', () => {
    it('returns columnMeta from ColumnBuilder', () => {
      const columnBuilder = new ColumnBuilderImpl('user', 'id', columnMeta);
      const result = getColumnMeta(
        columnBuilder as unknown as import('../../src/types').AnyColumnBuilder,
      );

      expect({
        hasResult: result !== undefined,
        codecId: result?.codecId,
        nullable: result?.nullable,
      }).toMatchObject({
        hasResult: true,
        codecId: 'pg/int4@1',
        nullable: false,
      });
    });

    it('returns undefined when columnMeta property does not exist', () => {
      const objectWithoutColumnMeta = {
        kind: 'column',
        table: 'user',
        column: 'id',
        // No columnMeta property
      };

      const result = getColumnMeta(
        objectWithoutColumnMeta as unknown as import('../../src/types').AnyColumnBuilder,
      );

      expect(result).toBeUndefined();
    });
  });

  describe('isParamPlaceholder', () => {
    it('returns true for valid param placeholder', () => {
      const paramPlaceholder = param('test');
      expect(isParamPlaceholder(paramPlaceholder)).toBe(true);
    });

    it.each([null, undefined, 'test', 42, true])(
      'returns false for non-object value: %s',
      (value) => {
        expect(isParamPlaceholder(value)).toBe(false);
      },
    );

    it.each([
      { name: 'test' },
      { kind: 'invalid', name: 'test' },
      { kind: 'param-placeholder' },
      { kind: 'param-placeholder', name: 123 },
      { kind: 'param-placeholder', name: null },
    ])('returns false for invalid object structure: %s', (value) => {
      expect(isParamPlaceholder(value)).toBe(false);
    });
  });
});
