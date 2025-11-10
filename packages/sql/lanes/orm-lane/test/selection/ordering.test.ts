import type { OrderBuilder } from '@prisma-next/sql-relational-core/types';
import type { OperationExpr } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { buildChildOrderByClause, buildOrderByClause } from '../../src/selection/ordering';

describe('ordering', () => {
  describe('buildOrderByClause', () => {
    it('returns undefined when orderBy is undefined', () => {
      const result = buildOrderByClause(undefined);
      expect(result).toBeUndefined();
    });

    it('builds orderBy clause with column builder', () => {
      const orderBy = {
        expr: {
          table: 'user',
          column: 'id',
        },
        dir: 'asc' as const,
      } as OrderBuilder<string, unknown, unknown>;
      const result = buildOrderByClause(orderBy);
      expect(result).toBeDefined();
      expect(result?.length).toBe(1);
      expect(result?.[0]?.expr.kind).toBe('col');
      expect(result?.[0]?.expr.table).toBe('user');
      expect(result?.[0]?.expr.column).toBe('id');
      expect(result?.[0]?.dir).toBe('asc');
    });

    it('builds orderBy clause with operation expr', () => {
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
      const orderBy = {
        expr: operationExpr,
        dir: 'desc' as const,
      } as OrderBuilder<string, unknown, unknown>;
      const result = buildOrderByClause(orderBy);
      expect(result).toBeDefined();
      expect(result?.length).toBe(1);
      expect(result?.[0]?.expr.kind).toBe('operation');
      expect(result?.[0]?.dir).toBe('desc');
    });

    it('builds orderBy clause with desc direction', () => {
      const orderBy = {
        expr: {
          table: 'user',
          column: 'createdAt',
        },
        dir: 'desc' as const,
      } as OrderBuilder<string, unknown, unknown>;
      const result = buildOrderByClause(orderBy);
      expect(result).toBeDefined();
      expect(result?.[0]?.dir).toBe('desc');
    });
  });

  describe('buildChildOrderByClause', () => {
    it('returns undefined when orderBy is undefined', () => {
      const result = buildChildOrderByClause(undefined);
      expect(result).toBeUndefined();
    });

    it('builds child orderBy clause with column builder', () => {
      const orderBy = {
        expr: {
          table: 'post',
          column: 'id',
        },
        dir: 'asc' as const,
      } as OrderBuilder<string, unknown, unknown>;
      const result = buildChildOrderByClause(orderBy);
      expect(result).toBeDefined();
      expect(result?.length).toBe(1);
      expect(result?.[0]?.expr.kind).toBe('col');
      expect(result?.[0]?.expr.table).toBe('post');
      expect(result?.[0]?.expr.column).toBe('id');
      expect(result?.[0]?.dir).toBe('asc');
    });

    it('builds child orderBy clause with operation expr', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        op: 'multiply',
        self: {
          kind: 'col',
          table: 'post',
          column: 'id',
        },
        args: [],
      };
      const orderBy = {
        expr: operationExpr,
        dir: 'desc' as const,
      } as OrderBuilder<string, unknown, unknown>;
      const result = buildChildOrderByClause(orderBy);
      expect(result).toBeDefined();
      expect(result?.length).toBe(1);
      expect(result?.[0]?.expr.kind).toBe('col');
      expect(result?.[0]?.expr.table).toBe('post');
      expect(result?.[0]?.expr.column).toBe('id');
      expect(result?.[0]?.dir).toBe('desc');
    });

    it('builds child orderBy clause with nested operation expr', () => {
      const innerOp: OperationExpr = {
        kind: 'operation',
        op: 'add',
        self: {
          kind: 'col',
          table: 'post',
          column: 'id',
        },
        args: [],
      };
      const outerOp: OperationExpr = {
        kind: 'operation',
        op: 'multiply',
        self: innerOp,
        args: [],
      };
      const orderBy = {
        expr: outerOp,
        dir: 'asc' as const,
      } as OrderBuilder<string, unknown, unknown>;
      const result = buildChildOrderByClause(orderBy);
      expect(result).toBeDefined();
      expect(result?.length).toBe(1);
      expect(result?.[0]?.expr.kind).toBe('col');
      expect(result?.[0]?.expr.table).toBe('post');
      expect(result?.[0]?.expr.column).toBe('id');
      expect(result?.[0]?.dir).toBe('asc');
    });
  });
});
