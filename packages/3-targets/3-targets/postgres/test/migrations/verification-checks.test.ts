import type { NullCheckExpr, OperationExpr, ParamRef } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { tableExistsAst } from '../../src/contract-free/checks';

describe('tableExistsAst — PG to_regclass check builder', () => {
  describe('tableAbsent()', () => {
    it('returns a FROM-less SelectAst projecting to_regclass($1) IS NULL', () => {
      const ast = tableExistsAst('public', 'users').tableAbsent();
      expect(ast.kind).toBe('select');
      expect(ast.from).toBeUndefined();
      expect(ast.projection).toHaveLength(1);

      const proj = ast.projection[0]!;
      expect(proj.alias).toBe('result');
      expect(proj.codec).toBeUndefined();

      const nullCheck = proj.expr as NullCheckExpr;
      expect(nullCheck.kind).toBe('null-check');
      expect(nullCheck.isNull).toBe(true);

      const opExpr = nullCheck.expr as OperationExpr;
      expect(opExpr.kind).toBe('operation');
      expect(opExpr.lowering.strategy).toBe('function');
      expect(opExpr.lowering.template).toBe('to_regclass({{self}})');

      const selfParam = opExpr.self as ParamRef;
      expect(selfParam.kind).toBe('param-ref');
      expect(selfParam.codec?.codecId).toBe('pg/text@1');
      expect(selfParam.value).toBe('"public"."users"');
    });

    it('collects the table-name param ref', () => {
      const ast = tableExistsAst('public', 'users').tableAbsent();
      const refs = ast.collectParamRefs();
      expect(refs).toHaveLength(1);
      const ref = refs[0] as ParamRef;
      expect(ref.value).toBe('"public"."users"');
    });
  });

  describe('tablePresent()', () => {
    it('returns a FROM-less SelectAst projecting to_regclass($1) IS NOT NULL', () => {
      const ast = tableExistsAst('public', 'users').tablePresent();
      const nullCheck = ast.projection[0]!.expr as NullCheckExpr;
      expect(nullCheck.isNull).toBe(false);
    });

    it('encodes the qualified name for the unbound namespace (no schema prefix)', () => {
      const ast = tableExistsAst('__unbound__', 'users').tableAbsent();
      const opExpr = (ast.projection[0]!.expr as NullCheckExpr).expr as OperationExpr;
      const selfParam = opExpr.self as ParamRef;
      // Unbound namespace yields just the quoted table name without schema
      expect(selfParam.value).toBe('"users"');
    });
  });
});

// Rendered-SQL lowering coverage lives in the adapter package
// (packages/3-targets/6-adapters/postgres/test/verification-checks-lowering.test.ts):
// the adapter depends on this target package, never the reverse.
