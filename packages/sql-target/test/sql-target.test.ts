import { describe, expect, it } from 'vitest';
import type { ColumnRef, OperationExpr } from '../src/sql-target';
import { isOperationExpr } from '../src/sql-target';

describe('sql-target', () => {
  describe('isOperationExpr', () => {
    it('returns true for OperationExpr', () => {
      const expr: OperationExpr = {
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

      expect(isOperationExpr(expr)).toBe(true);
    });

    it('returns false for ColumnRef', () => {
      const expr: ColumnRef = {
        kind: 'col',
        table: 'user',
        column: 'email',
      };

      expect(isOperationExpr(expr)).toBe(false);
    });
  });
});
