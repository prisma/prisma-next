import type { ColumnRef, OperationExpr, ParamRef } from '@prisma-next/sql-relational-core/ast';
import {
  createColumnRef,
  createLiteralExpr,
  createParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { createExpressionBuilder } from '@prisma-next/sql-relational-core/expression-builder';
import type { ColumnBuilder } from '@prisma-next/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import {
  collectColumnRefs,
  extractBaseColumnRef,
  extractExpression,
  getColumnInfo,
  isColumnBuilder,
  isOperationExpr,
} from '../../src/utils/guards';

describe('guards', () => {
  describe('extractBaseColumnRef', () => {
    it('returns ColumnRef directly when expr is ColumnRef', () => {
      const colRef: ColumnRef = createColumnRef('user', 'id');
      const result = extractBaseColumnRef(colRef);
      expect({
        isColRef: result === colRef,
        table: result.table,
        column: result.column,
      }).toMatchObject({
        isColRef: true,
        table: 'user',
        column: 'id',
      });
    });

    it('recursively unwraps OperationExpr to find base ColumnRef', () => {
      const baseCol: ColumnRef = createColumnRef('user', 'id');
      const operation1: OperationExpr = {
        kind: 'operation',
        method: 'normalize',
        forTypeId: 'pg/vector@1',
        self: baseCol,
        args: [],
        returns: { kind: 'typeId', type: 'pg/vector@1' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: 'normalize(${self})',
        },
      };
      const operation2: OperationExpr = {
        kind: 'operation',
        method: 'cosineDistance',
        forTypeId: 'pg/vector@1',
        self: operation1,
        args: [],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} <=> ${arg0}',
        },
      };

      const result = extractBaseColumnRef(operation2);
      expect({
        equalsBaseCol: result === baseCol,
        table: result.table,
        column: result.column,
      }).toMatchObject({
        equalsBaseCol: true,
        table: 'user',
        column: 'id',
      });
    });
  });

  describe('collectColumnRefs', () => {
    it('returns single ColumnRef for ColumnRef input', () => {
      const colRef: ColumnRef = createColumnRef('user', 'id');
      const result = collectColumnRefs(colRef);
      expect(result).toEqual([colRef]);
    });

    it('returns empty array for ParamRef', () => {
      const paramRef: ParamRef = createParamRef(1, 'userId');
      const result = collectColumnRefs(paramRef);
      expect(result).toEqual([]);
    });

    it('returns empty array for LiteralExpr', () => {
      const literalExpr = createLiteralExpr('test');
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
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} = ${arg0}',
        },
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
        forTypeId: 'pg/vector@1',
        self: col1,
        args: [],
        returns: { kind: 'typeId', type: 'pg/vector@1' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: 'normalize(${self})',
        },
      };
      const outerOp: OperationExpr = {
        kind: 'operation',
        method: 'cosineDistance',
        forTypeId: 'pg/vector@1',
        self: innerOp,
        args: [col2],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} <=> ${arg0}',
        },
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
        forTypeId: 'pg/vector@1',
        self: colRef,
        args: [],
        returns: { kind: 'typeId', type: 'pg/vector@1' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: 'normalize(${self})',
        },
      };

      expect(isOperationExpr(operation)).toBe(true);
    });

    it('returns false for ColumnBuilder', () => {
      const columnBuilder = {
        kind: 'column' as const,
        table: 'user',
        column: 'id',
        columnMeta: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      } as ColumnBuilder;

      const expr = extractExpression(columnBuilder);
      expect(isOperationExpr(expr)).toBe(false);
    });

    it('returns false for null', () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      expect(isOperationExpr(null as any)).toBe(false);
    });

    it('returns false for undefined', () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      expect(isOperationExpr(undefined as any)).toBe(false);
    });

    it('returns false for plain object without kind', () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      expect(isOperationExpr({ table: 'user', column: 'id' } as any)).toBe(false);
    });
  });

  describe('getColumnInfo', () => {
    it('extracts table and column from ColumnBuilder', () => {
      const columnBuilder = {
        kind: 'column' as const,
        table: 'user',
        column: 'id',
        columnMeta: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      } as ColumnBuilder;

      const result = getColumnInfo(columnBuilder);
      expect(result).toEqual({ table: 'user', column: 'id' });
    });

    it('extracts table and column from OperationExpr by unwrapping', () => {
      const baseCol: ColumnRef = createColumnRef('user', 'id');
      const operation: OperationExpr = {
        kind: 'operation',
        method: 'normalize',
        forTypeId: 'pg/vector@1',
        self: baseCol,
        args: [],
        returns: { kind: 'typeId', type: 'pg/vector@1' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: 'normalize(${self})',
        },
      };

      const exprBuilder = createExpressionBuilder(operation, {
        nativeType: 'vector',
        codecId: 'pg/vector@1',
        nullable: false,
      });
      const result = getColumnInfo(exprBuilder);
      expect(result).toEqual({ table: 'user', column: 'id' });
    });

    it('extracts table and column from deeply nested OperationExpr', () => {
      const baseCol: ColumnRef = createColumnRef('user', 'id');
      const innerOp: OperationExpr = {
        kind: 'operation',
        method: 'normalize',
        forTypeId: 'pg/vector@1',
        self: baseCol,
        args: [],
        returns: { kind: 'typeId', type: 'pg/vector@1' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: 'normalize(${self})',
        },
      };
      const outerOp: OperationExpr = {
        kind: 'operation',
        method: 'cosineDistance',
        forTypeId: 'pg/vector@1',
        self: innerOp,
        args: [],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} <=> ${arg0}',
        },
      };

      const exprBuilder = createExpressionBuilder(outerOp, {
        nativeType: 'vector',
        codecId: 'pg/vector@1',
        nullable: false,
      });
      const result = getColumnInfo(exprBuilder);
      expect(result).toEqual({ table: 'user', column: 'id' });
    });
  });

  describe('isColumnBuilder', () => {
    it('returns true for ColumnBuilder', () => {
      const columnBuilder = {
        kind: 'column' as const,
        table: 'user',
        column: 'id',
        columnMeta: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      } as ColumnBuilder;

      expect(isColumnBuilder(columnBuilder)).toBe(true);
    });

    it('returns false for OperationExpr', () => {
      const colRef: ColumnRef = createColumnRef('user', 'id');
      const operation: OperationExpr = {
        kind: 'operation',
        method: 'normalize',
        forTypeId: 'pg/vector@1',
        self: colRef,
        args: [],
        returns: { kind: 'typeId', type: 'pg/vector@1' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: 'normalize(${self})',
        },
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
