import type { OperationExpr } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef } from '@prisma-next/sql-relational-core/ast';
import type { OrderBuilder } from '@prisma-next/sql-relational-core/types';
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
      } as OrderBuilder<string, { type: 'pg/int4@1'; nullable: false }, unknown>;
      const result = buildOrderByClause(orderBy);
      expect({
        defined: result !== undefined,
        length: result?.length,
        expr: result?.[0]?.expr,
        dir: result?.[0]?.dir,
      }).toMatchObject({
        defined: true,
        length: 1,
        expr: { kind: 'col', table: 'user', column: 'id' },
        dir: 'asc',
      });
    });

    it('builds orderBy clause with operation expr', () => {
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
      const orderBy = {
        expr: operationExpr,
        dir: 'desc' as const,
      } as OrderBuilder<string, { type: 'pg/int4@1'; nullable: false }, unknown>;
      const result = buildOrderByClause(orderBy);
      expect({
        defined: result !== undefined,
        length: result?.length,
        exprKind: result?.[0]?.expr.kind,
        dir: result?.[0]?.dir,
      }).toMatchObject({
        defined: true,
        length: 1,
        exprKind: 'operation',
        dir: 'desc',
      });
    });

    it('builds orderBy clause with desc direction', () => {
      const orderBy = {
        expr: {
          table: 'user',
          column: 'createdAt',
        },
        dir: 'desc' as const,
      } as OrderBuilder<string, { type: 'pg/int4@1'; nullable: false }, unknown>;
      const result = buildOrderByClause(orderBy);
      expect({
        defined: result !== undefined,
        dir: result?.[0]?.dir,
      }).toMatchObject({
        defined: true,
        dir: 'desc',
      });
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
      } as OrderBuilder<string, { type: 'pg/int4@1'; nullable: false }, unknown>;
      const result = buildChildOrderByClause(orderBy);
      expect({
        defined: result !== undefined,
        length: result?.length,
        expr: result?.[0]?.expr,
        dir: result?.[0]?.dir,
      }).toMatchObject({
        defined: true,
        length: 1,
        expr: { kind: 'col', table: 'post', column: 'id' },
        dir: 'asc',
      });
    });

    it('builds child orderBy clause with operation expr', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'multiply',
        forTypeId: 'pg/int4@1',
        self: createColumnRef('post', 'id'),
        args: [],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} * ${arg0}',
        },
      };
      const orderBy = {
        expr: operationExpr,
        dir: 'desc' as const,
      } as OrderBuilder<string, { type: 'pg/int4@1'; nullable: false }, unknown>;
      const result = buildChildOrderByClause(orderBy);
      expect({
        defined: result !== undefined,
        length: result?.length,
        expr: result?.[0]?.expr,
        dir: result?.[0]?.dir,
      }).toMatchObject({
        defined: true,
        length: 1,
        expr: { kind: 'col', table: 'post', column: 'id' },
        dir: 'desc',
      });
    });

    it('builds child orderBy clause with nested operation expr', () => {
      const innerOp: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: createColumnRef('post', 'id'),
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
      const orderBy = {
        expr: outerOp,
        dir: 'asc' as const,
      } as OrderBuilder<string, { type: 'pg/int4@1'; nullable: false }, unknown>;
      const result = buildChildOrderByClause(orderBy);
      expect({
        defined: result !== undefined,
        length: result?.length,
        expr: result?.[0]?.expr,
        dir: result?.[0]?.dir,
      }).toMatchObject({
        defined: true,
        length: 1,
        expr: { kind: 'col', table: 'post', column: 'id' },
        dir: 'asc',
      });
    });
  });
});
