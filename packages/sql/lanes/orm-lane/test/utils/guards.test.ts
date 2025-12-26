import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { OperationExpr } from '@prisma-next/sql-relational-core/ast';
import {
  createColumnRef,
  createLiteralExpr,
  createParamRef,
} from '@prisma-next/sql-relational-core/ast';
import type { AnyColumnBuilder } from '@prisma-next/sql-relational-core/types';
import {
  collectColumnRefs,
  extractBaseColumnRef,
  getColumnInfo,
  isColumnBuilder,
  isOperationExpr,
} from '@prisma-next/sql-relational-core/utils/guards';
import { describe, expect, it } from 'vitest';

describe('guards', () => {
  const int4ColumnMeta: StorageColumn = {
    nativeType: 'int4',
    codecId: 'pg/int4@1',
    nullable: false,
  };

  describe('extractBaseColumnRef', () => {
    it('returns column ref when expr is already a column ref', () => {
      const colRef = createColumnRef('user', 'id');
      const result = extractBaseColumnRef(colRef);
      expect(result).toBe(colRef);
      expect(result).toMatchObject({ kind: 'col', table: 'user', column: 'id' });
    });

    it('extracts base column ref from operation expr', () => {
      const baseCol = createColumnRef('user', 'id');
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: baseCol,
        args: [],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };
      const result = extractBaseColumnRef(operationExpr);
      expect(result).toBe(baseCol);
      expect(result).toMatchObject({ kind: 'col', table: 'user', column: 'id' });
    });

    it('extracts base column ref from nested operation expr', () => {
      const baseCol = createColumnRef('user', 'id');
      const innerOp: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: baseCol,
        args: [],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };
      const outerOp: OperationExpr = {
        kind: 'operation',
        method: 'multiply',
        forTypeId: 'pg/int4@1',
        self: innerOp,
        args: [],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} * ${arg0}',
        },
      };
      const result = extractBaseColumnRef(outerOp);
      expect({
        isBaseCol: result === baseCol,
        kind: result.kind,
        table: result.table,
        column: result.column,
      }).toMatchObject({
        isBaseCol: true,
        kind: 'col',
        table: 'user',
        column: 'id',
      });
    });
  });

  describe('collectColumnRefs', () => {
    it('returns single column ref for column ref input', () => {
      const colRef = createColumnRef('user', 'id');
      const result = collectColumnRefs(colRef);
      expect(result).toEqual([colRef]);
    });

    it('returns empty array for param ref', () => {
      const paramRef = createParamRef(0, 'userId');
      const result = collectColumnRefs(paramRef);
      expect(result).toEqual([]);
    });

    it('returns empty array for literal expr', () => {
      const literalExpr = createLiteralExpr(42);
      const result = collectColumnRefs(literalExpr);
      expect(result).toEqual([]);
    });

    it('collects column refs from operation expr', () => {
      const col1 = createColumnRef('user', 'id');
      const col2 = createColumnRef('user', 'email');
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: col1,
        args: [col2],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };
      const result = collectColumnRefs(operationExpr);
      expect(result).toEqual([col1, col2]);
    });

    it('collects column refs from nested operation expr', () => {
      const col1 = createColumnRef('user', 'id');
      const col2 = createColumnRef('user', 'email');
      const col3 = createColumnRef('user', 'name');
      const innerOp: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: col1,
        args: [col2],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };
      const outerOp: OperationExpr = {
        kind: 'operation',
        method: 'multiply',
        forTypeId: 'pg/int4@1',
        self: innerOp,
        args: [col3],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} * ${arg0}',
        },
      };
      const result = collectColumnRefs(outerOp);
      expect(result).toEqual([col1, col2, col3]);
    });
  });

  describe('isOperationExpr', () => {
    it('returns true for operation expr', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: createColumnRef('user', 'id'),
        args: [],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };
      expect(isOperationExpr(operationExpr)).toBe(true);
    });

    it('returns false for column builder', () => {
      const colBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: int4ColumnMeta,
      } as unknown as AnyColumnBuilder;
      expect(isOperationExpr(colBuilder)).toBe(false);
    });

    it('returns false for null', () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      expect(isOperationExpr(null as any)).toBe(false);
    });

    it('returns false for undefined', () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      expect(isOperationExpr(undefined as any)).toBe(false);
    });

    it('returns false for object without kind', () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      expect(isOperationExpr({ table: 'user', column: 'id' } as any)).toBe(false);
    });

    it('returns false for object with wrong kind', () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      expect(isOperationExpr(createColumnRef('user', 'id') as any)).toBe(false);
    });
  });

  describe('getColumnInfo', () => {
    it('extracts column info from operation expr', () => {
      const baseCol = createColumnRef('user', 'id');
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: baseCol,
        args: [],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };
      const result = getColumnInfo(operationExpr);
      expect(result).toEqual({ table: 'user', column: 'id' });
    });

    it('extracts column info from column builder', () => {
      const colBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: int4ColumnMeta,
      } as unknown as AnyColumnBuilder;
      const result = getColumnInfo(colBuilder);
      expect(result).toEqual({ table: 'user', column: 'id' });
    });
  });

  describe('isColumnBuilder', () => {
    it('returns true for column builder', () => {
      const colBuilder = {
        kind: 'column',
        table: 'user',
        column: 'id',
        columnMeta: int4ColumnMeta,
      } as unknown as AnyColumnBuilder;
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
      expect(isColumnBuilder(createColumnRef('user', 'id'))).toBe(false);
    });

    it('returns false for object with kind but not column', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: createColumnRef('user', 'id'),
        args: [],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };
      expect(isColumnBuilder(operationExpr)).toBe(false);
    });
  });
});
