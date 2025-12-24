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

    it('returns false for null', () => {
      expect(isParamPlaceholder(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isParamPlaceholder(undefined)).toBe(false);
    });

    it('returns false for string', () => {
      expect(isParamPlaceholder('test')).toBe(false);
    });

    it('returns false for number', () => {
      expect(isParamPlaceholder(42)).toBe(false);
    });

    it('returns false for boolean', () => {
      expect(isParamPlaceholder(true)).toBe(false);
    });

    it('returns false for object without kind property', () => {
      expect(isParamPlaceholder({ name: 'test' })).toBe(false);
    });

    it('returns false for object with wrong kind', () => {
      expect(isParamPlaceholder({ kind: 'invalid', name: 'test' })).toBe(false);
    });

    it('returns false for object with correct kind but missing name', () => {
      expect(isParamPlaceholder({ kind: 'param-placeholder' })).toBe(false);
    });

    it('returns false for object with correct kind but name is not string', () => {
      expect(isParamPlaceholder({ kind: 'param-placeholder', name: 123 })).toBe(false);
    });

    it('returns false for object with correct kind but name is null', () => {
      expect(isParamPlaceholder({ kind: 'param-placeholder', name: null })).toBe(false);
    });
  });
});
