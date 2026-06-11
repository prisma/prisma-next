import {
  AggregateExpr,
  type BinaryExpr,
  type FunctionSource,
  type IdentifierRef,
  type LiteralExpr,
  type ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { columnExistsAst } from '../../src/contract-free/checks';

describe('columnExistsAst — SQLite pragma_table_info check builder', () => {
  describe('columnAbsent()', () => {
    it('returns a SelectAst FROM pragma_table_info projecting COUNT(*) = 0', () => {
      const ast = columnExistsAst('users', 'email').columnAbsent();
      expect(ast.kind).toBe('select');

      const src = ast.from as FunctionSource;
      expect(src.kind).toBe('function-source');
      expect(src.fn).toBe('pragma_table_info');
      expect(src.args).toHaveLength(1);
      const tableParam = src.args[0] as ParamRef;
      expect(tableParam.value).toBe('users');
      expect(tableParam.codec?.codecId).toBe('sqlite/text@1');

      expect(ast.projection).toHaveLength(1);
      const proj = ast.projection[0]!;
      expect(proj.alias).toBe('result');
      expect(proj.codec).toBeUndefined();

      const binary = proj.expr as BinaryExpr;
      expect(binary.op).toBe('eq');
      expect(binary.left).toBeInstanceOf(AggregateExpr);
      expect((binary.left as AggregateExpr).fn).toBe('count');
      const right = binary.right as LiteralExpr;
      expect(right.value).toBe(0);

      const where = ast.where as BinaryExpr;
      expect(where.op).toBe('eq');
      const col = where.left as IdentifierRef;
      expect(col.kind).toBe('identifier-ref');
      expect(col.name).toBe('name');
      const colParam = where.right as ParamRef;
      expect(colParam.value).toBe('email');
      expect(colParam.codec?.codecId).toBe('sqlite/text@1');
    });
  });

  describe('columnPresent()', () => {
    it('returns a SelectAst projecting COUNT(*) > 0', () => {
      const ast = columnExistsAst('users', 'email').columnPresent();
      const binary = ast.projection[0]!.expr as BinaryExpr;
      expect(binary.op).toBe('gt');
      const right = binary.right as LiteralExpr;
      expect(right.value).toBe(0);
    });

    it('uses the same FROM pragma_table_info and WHERE clause', () => {
      const ast = columnExistsAst('orders', 'status').columnPresent();
      const src = ast.from as FunctionSource;
      expect((src.args[0] as ParamRef).value).toBe('orders');
      const where = ast.where as BinaryExpr;
      expect((where.right as ParamRef).value).toBe('status');
    });
  });

  it('collects both param refs (table name + column name)', () => {
    const ast = columnExistsAst('users', 'email').columnAbsent();
    const refs = ast.collectParamRefs();
    const values = refs.map((r) => (r as ParamRef).value);
    expect(values).toContain('users');
    expect(values).toContain('email');
  });
});

// Rendered-SQL lowering coverage lives in the adapter package
// (packages/3-targets/6-adapters/sqlite/test/verification-checks-lowering.test.ts):
// the adapter depends on this target package, never the reverse.
