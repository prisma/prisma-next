import { describe, expect, it } from 'vitest';
import {
  createColumnRef,
  createLiteralExpr,
  createOperationExpr,
  createParamRef,
  createTableRef,
} from '../../src/ast/common';
import type { OperationExpr } from '../../src/ast/types';

describe('ast/common', () => {
  describe('createTableRef', () => {
    it('creates table ref with name', () => {
      const tableRef = createTableRef('user');
      expect(tableRef).toEqual({
        kind: 'table',
        name: 'user',
      });
      expect(tableRef.kind).toBe('table');
      expect(tableRef.name).toBe('user');
    });

    it('creates table ref with different name', () => {
      const tableRef = createTableRef('post');
      expect(tableRef.name).toBe('post');
    });
  });

  describe('createColumnRef', () => {
    it('creates column ref with table and column', () => {
      const columnRef = createColumnRef('user', 'id');
      expect(columnRef).toEqual({
        kind: 'col',
        table: 'user',
        column: 'id',
      });
      expect(columnRef.kind).toBe('col');
      expect(columnRef.table).toBe('user');
      expect(columnRef.column).toBe('id');
    });

    it('creates column ref with different table and column', () => {
      const columnRef = createColumnRef('post', 'title');
      expect(columnRef.table).toBe('post');
      expect(columnRef.column).toBe('title');
    });
  });

  describe('createParamRef', () => {
    it('creates param ref with index', () => {
      const paramRef = createParamRef(0);
      expect(paramRef).toEqual({
        kind: 'param',
        index: 0,
      });
      expect(paramRef.kind).toBe('param');
      expect(paramRef.index).toBe(0);
      expect(paramRef.name).toBeUndefined();
    });

    it('creates param ref with index and name', () => {
      const paramRef = createParamRef(1, 'userId');
      expect(paramRef).toEqual({
        kind: 'param',
        index: 1,
        name: 'userId',
      });
      expect(paramRef.index).toBe(1);
      expect(paramRef.name).toBe('userId');
    });

    it('creates param ref with different index', () => {
      const paramRef = createParamRef(5);
      expect(paramRef.index).toBe(5);
    });
  });

  describe('createOperationExpr', () => {
    it('returns operation expr as-is', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'test',
        forTypeId: 'pg/text@1',
        self: { kind: 'col', table: 'user', column: 'email' },
        args: [],
        returns: { kind: 'builtin', type: 'string' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: 'test(${self})',
        },
      };

      const result = createOperationExpr(operationExpr);
      expect(result).toBe(operationExpr);
      expect(result.kind).toBe('operation');
      expect(result.method).toBe('test');
    });

    it('returns operation expr with args', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: { kind: 'col', table: 'user', column: 'id' },
        args: [{ kind: 'param', index: 0, name: 'value' }],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };

      const result = createOperationExpr(operationExpr);
      expect(result).toBe(operationExpr);
      expect(result.args).toHaveLength(1);
    });
  });

  describe('createLiteralExpr', () => {
    it('creates literal expr with string value', () => {
      const literalExpr = createLiteralExpr('test');
      expect(literalExpr).toEqual({
        kind: 'literal',
        value: 'test',
      });
      expect(literalExpr.kind).toBe('literal');
      expect(literalExpr.value).toBe('test');
    });

    it('creates literal expr with number value', () => {
      const literalExpr = createLiteralExpr(42);
      expect(literalExpr.value).toBe(42);
    });

    it('creates literal expr with boolean value', () => {
      const literalExpr = createLiteralExpr(true);
      expect(literalExpr.value).toBe(true);
    });

    it('creates literal expr with null value', () => {
      const literalExpr = createLiteralExpr(null);
      expect(literalExpr.value).toBeNull();
    });

    it('creates literal expr with object value', () => {
      const obj = { key: 'value' };
      const literalExpr = createLiteralExpr(obj);
      expect(literalExpr.value).toBe(obj);
    });

    it('creates literal expr with array value', () => {
      const arr = [1, 2, 3];
      const literalExpr = createLiteralExpr(arr);
      expect(literalExpr.value).toBe(arr);
    });
  });
});
