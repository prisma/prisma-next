import type { AnyColumnBuilder } from '@prisma-next/sql-relational-core/types';
import type { ColumnRef, LiteralExpr, OperationExpr, ParamRef } from '@prisma-next/sql-target';
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
    it('returns column ref when expr is already a column ref', () => {
      const colRef: ColumnRef = {
        kind: 'col',
        table: 'user',
        column: 'id',
      };
      const result = extractBaseColumnRef(colRef);
      expect(result).toBe(colRef);
      expect(result.kind).toBe('col');
      expect(result.table).toBe('user');
      expect(result.column).toBe('id');
    });

    it('extracts base column ref from operation expr', () => {
      const baseCol: ColumnRef = {
        kind: 'col',
        table: 'user',
        column: 'id',
      };
      const operationExpr: OperationExpr = {
        kind: 'operation',
        op: 'add',
        self: baseCol,
        args: [],
      };
      const result = extractBaseColumnRef(operationExpr);
      expect(result).toBe(baseCol);
      expect(result.kind).toBe('col');
      expect(result.table).toBe('user');
      expect(result.column).toBe('id');
    });

    it('extracts base column ref from nested operation expr', () => {
      const baseCol: ColumnRef = {
        kind: 'col',
        table: 'user',
        column: 'id',
      };
      const innerOp: OperationExpr = {
        kind: 'operation',
        op: 'add',
        self: baseCol,
        args: [],
      };
      const outerOp: OperationExpr = {
        kind: 'operation',
        op: 'multiply',
        self: innerOp,
        args: [],
      };
      const result = extractBaseColumnRef(outerOp);
      expect(result).toBe(baseCol);
      expect(result.kind).toBe('col');
      expect(result.table).toBe('user');
      expect(result.column).toBe('id');
    });
  });

  describe('collectColumnRefs', () => {
    it('returns single column ref for column ref input', () => {
      const colRef: ColumnRef = {
        kind: 'col',
        table: 'user',
        column: 'id',
      };
      const result = collectColumnRefs(colRef);
      expect(result).toEqual([colRef]);
    });

    it('returns empty array for param ref', () => {
      const paramRef: ParamRef = {
        kind: 'param',
        index: 0,
        name: 'userId',
      };
      const result = collectColumnRefs(paramRef);
      expect(result).toEqual([]);
    });

    it('returns empty array for literal expr', () => {
      const literalExpr: LiteralExpr = {
        kind: 'literal',
        value: 42,
      };
      const result = collectColumnRefs(literalExpr);
      expect(result).toEqual([]);
    });

    it('collects column refs from operation expr', () => {
      const col1: ColumnRef = {
        kind: 'col',
        table: 'user',
        column: 'id',
      };
      const col2: ColumnRef = {
        kind: 'col',
        table: 'user',
        column: 'email',
      };
      const operationExpr: OperationExpr = {
        kind: 'operation',
        op: 'add',
        self: col1,
        args: [col2],
      };
      const result = collectColumnRefs(operationExpr);
      expect(result).toEqual([col1, col2]);
    });

    it('collects column refs from nested operation expr', () => {
      const col1: ColumnRef = {
        kind: 'col',
        table: 'user',
        column: 'id',
      };
      const col2: ColumnRef = {
        kind: 'col',
        table: 'user',
        column: 'email',
      };
      const col3: ColumnRef = {
        kind: 'col',
        table: 'user',
        column: 'name',
      };
      const innerOp: OperationExpr = {
        kind: 'operation',
        op: 'add',
        self: col1,
        args: [col2],
      };
      const outerOp: OperationExpr = {
        kind: 'operation',
        op: 'multiply',
        self: innerOp,
        args: [col3],
      };
      const result = collectColumnRefs(outerOp);
      expect(result).toEqual([col1, col2, col3]);
    });
  });

  describe('isOperationExpr', () => {
    it('returns true for operation expr', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        op: 'add',
        self: {
          kind: 'col',
          table: 'user',
          column: 'id',
        },
        args: [],
      };
      expect(isOperationExpr(operationExpr)).toBe(true);
    });

    it('returns false for column builder', () => {
      const colBuilder: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: { type: 'pg/int4@1', nullable: false },
      };
      expect(isOperationExpr(colBuilder)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isOperationExpr(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isOperationExpr(undefined)).toBe(false);
    });

    it('returns false for object without kind', () => {
      expect(isOperationExpr({ table: 'user', column: 'id' })).toBe(false);
    });

    it('returns false for object with wrong kind', () => {
      expect(isOperationExpr({ kind: 'col', table: 'user', column: 'id' })).toBe(false);
    });
  });

  describe('getColumnInfo', () => {
    it('extracts column info from operation expr', () => {
      const baseCol: ColumnRef = {
        kind: 'col',
        table: 'user',
        column: 'id',
      };
      const operationExpr: OperationExpr = {
        kind: 'operation',
        op: 'add',
        self: baseCol,
        args: [],
      };
      const result = getColumnInfo(operationExpr);
      expect(result).toEqual({ table: 'user', column: 'id' });
    });

    it('extracts column info from column builder', () => {
      const colBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: { type: 'pg/int4@1', nullable: false },
      } as AnyColumnBuilder;
      const result = getColumnInfo(colBuilder);
      expect(result).toEqual({ table: 'user', column: 'id' });
    });
  });

  describe('isColumnBuilder', () => {
    it('returns true for column builder', () => {
      const colBuilder: AnyColumnBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: { type: 'pg/int4@1', nullable: false },
      };
      expect(isColumnBuilder(colBuilder)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isColumnBuilder(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isColumnBuilder(undefined)).toBe(false);
    });

    it('returns false for string', () => {
      expect(isColumnBuilder('not a column')).toBe(false);
    });

    it('returns false for number', () => {
      expect(isColumnBuilder(42)).toBe(false);
    });

    it('returns false for object without kind', () => {
      expect(isColumnBuilder({ table: 'user', column: 'id' })).toBe(false);
    });

    it('returns false for object with wrong kind', () => {
      expect(isColumnBuilder({ kind: 'col', table: 'user', column: 'id' })).toBe(false);
    });

    it('returns false for object with kind but not column', () => {
      expect(isColumnBuilder({ kind: 'operation', op: 'add', self: null, args: [] })).toBe(false);
    });
  });
});
