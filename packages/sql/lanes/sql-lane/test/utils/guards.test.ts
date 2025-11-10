import { createColumnRef } from '@prisma-next/sql-relational-core/ast';
import type { ColumnBuilder } from '@prisma-next/sql-relational-core/types';
import type { ColumnRef, OperationExpr, ParamRef } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import {
  collectColumnRefs,
  extractBaseColumnRef,
  getColumnInfo,
  isColumnBuilder,
  isOperationExpr,
} from '../../src/utils/guards';

describe('guards', () => {
  describe('extractBaseColumnRef', () => {
    it('returns ColumnRef directly when expr is ColumnRef', () => {
      const colRef: ColumnRef = createColumnRef('user', 'id');
      const result = extractBaseColumnRef(colRef);
      expect(result).toBe(colRef);
      expect(result.table).toBe('user');
      expect(result.column).toBe('id');
    });

    it('recursively unwraps OperationExpr to find base ColumnRef', () => {
      const baseCol: ColumnRef = createColumnRef('user', 'id');
      const operation1: OperationExpr = {
        kind: 'operation',
        method: 'normalize',
        forTypeId: 'pgvector/vector@1',
        self: baseCol,
        args: [],
        returns: { kind: 'typeId', type: 'pgvector/vector@1' },
      };
      const operation2: OperationExpr = {
        kind: 'operation',
        method: 'cosineDistance',
        forTypeId: 'pgvector/vector@1',
        self: operation1,
        args: [],
        returns: { kind: 'builtin', type: 'float8' },
      };

      const result = extractBaseColumnRef(operation2);
      expect(result).toEqual(baseCol);
      expect(result.table).toBe('user');
      expect(result.column).toBe('id');
    });
  });

  describe('collectColumnRefs', () => {
    it('returns single ColumnRef for ColumnRef input', () => {
      const colRef: ColumnRef = createColumnRef('user', 'id');
      const result = collectColumnRefs(colRef);
      expect(result).toEqual([colRef]);
    });

    it('returns empty array for ParamRef', () => {
      const paramRef: ParamRef = { kind: 'param', index: 1, name: 'userId' };
      const result = collectColumnRefs(paramRef);
      expect(result).toEqual([]);
    });

    it('returns empty array for LiteralExpr', () => {
      const literalExpr = { kind: 'literal', value: 'test' as const };
      const result = collectColumnRefs(literalExpr);
      expect(result).toEqual([]);
    });

    it('collects ColumnRefs from nested OperationExpr', () => {
      const col1: ColumnRef = createColumnRef('user', 'id');
      const col2: ColumnRef = createColumnRef('user', 'email');
      const operation: OperationExpr = {
        kind: 'operation',
        method: 'eq',
        forTypeId: 'pg/int4@1',
        self: col1,
        args: [col2],
        returns: { kind: 'builtin', type: 'boolean' },
      };

      const result = collectColumnRefs(operation);
      expect(result).toHaveLength(2);
      expect(result).toContainEqual(col1);
      expect(result).toContainEqual(col2);
    });

    it('collects ColumnRefs from deeply nested OperationExpr', () => {
      const col1: ColumnRef = createColumnRef('user', 'id');
      const col2: ColumnRef = createColumnRef('user', 'email');
      const innerOp: OperationExpr = {
        kind: 'operation',
        method: 'normalize',
        forTypeId: 'pgvector/vector@1',
        self: col1,
        args: [],
        returns: { kind: 'typeId', type: 'pgvector/vector@1' },
      };
      const outerOp: OperationExpr = {
        kind: 'operation',
        method: 'cosineDistance',
        forTypeId: 'pgvector/vector@1',
        self: innerOp,
        args: [col2],
        returns: { kind: 'builtin', type: 'float8' },
      };

      const result = collectColumnRefs(outerOp);
      expect(result).toHaveLength(2);
      expect(result).toContainEqual(col1);
      expect(result).toContainEqual(col2);
    });
  });

  describe('isOperationExpr', () => {
    it('returns true for OperationExpr', () => {
      const colRef: ColumnRef = createColumnRef('user', 'id');
      const operation: OperationExpr = {
        kind: 'operation',
        method: 'normalize',
        forTypeId: 'pgvector/vector@1',
        self: colRef,
        args: [],
        returns: { kind: 'typeId', type: 'pgvector/vector@1' },
      };

      expect(isOperationExpr(operation)).toBe(true);
    });

    it('returns false for ColumnBuilder', () => {
      const columnBuilder = {
        kind: 'column' as const,
        table: 'user',
        column: 'id',
        columnMeta: { type: 'pg/int4@1', nullable: false },
      } as ColumnBuilder;

      expect(isOperationExpr(columnBuilder)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isOperationExpr(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isOperationExpr(undefined)).toBe(false);
    });

    it('returns false for plain object without kind', () => {
      expect(isOperationExpr({ table: 'user', column: 'id' })).toBe(false);
    });
  });

  describe('getColumnInfo', () => {
    it('extracts table and column from ColumnBuilder', () => {
      const columnBuilder = {
        kind: 'column' as const,
        table: 'user',
        column: 'id',
        columnMeta: { type: 'pg/int4@1', nullable: false },
      } as ColumnBuilder;

      const result = getColumnInfo(columnBuilder);
      expect(result).toEqual({ table: 'user', column: 'id' });
    });

    it('extracts table and column from OperationExpr by unwrapping', () => {
      const baseCol: ColumnRef = createColumnRef('user', 'id');
      const operation: OperationExpr = {
        kind: 'operation',
        method: 'normalize',
        forTypeId: 'pgvector/vector@1',
        self: baseCol,
        args: [],
        returns: { kind: 'typeId', type: 'pgvector/vector@1' },
      };

      const result = getColumnInfo(operation);
      expect(result).toEqual({ table: 'user', column: 'id' });
    });

    it('extracts table and column from deeply nested OperationExpr', () => {
      const baseCol: ColumnRef = createColumnRef('user', 'id');
      const innerOp: OperationExpr = {
        kind: 'operation',
        method: 'normalize',
        forTypeId: 'pgvector/vector@1',
        self: baseCol,
        args: [],
        returns: { kind: 'typeId', type: 'pgvector/vector@1' },
      };
      const outerOp: OperationExpr = {
        kind: 'operation',
        method: 'cosineDistance',
        forTypeId: 'pgvector/vector@1',
        self: innerOp,
        args: [],
        returns: { kind: 'builtin', type: 'float8' },
      };

      const result = getColumnInfo(outerOp);
      expect(result).toEqual({ table: 'user', column: 'id' });
    });
  });

  describe('isColumnBuilder', () => {
    it('returns true for ColumnBuilder', () => {
      const columnBuilder = {
        kind: 'column' as const,
        table: 'user',
        column: 'id',
        columnMeta: { type: 'pg/int4@1', nullable: false },
      } as ColumnBuilder;

      expect(isColumnBuilder(columnBuilder)).toBe(true);
    });

    it('returns false for OperationExpr', () => {
      const colRef: ColumnRef = createColumnRef('user', 'id');
      const operation: OperationExpr = {
        kind: 'operation',
        method: 'normalize',
        forTypeId: 'pgvector/vector@1',
        self: colRef,
        args: [],
        returns: { kind: 'typeId', type: 'pgvector/vector@1' },
      };

      expect(isColumnBuilder(operation)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isColumnBuilder(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isColumnBuilder(undefined)).toBe(false);
    });

    it('returns false for plain object without kind', () => {
      expect(isColumnBuilder({ table: 'user', column: 'id' })).toBe(false);
    });

    it('returns false for object with wrong kind', () => {
      expect(isColumnBuilder({ kind: 'operation' })).toBe(false);
    });
  });
});
