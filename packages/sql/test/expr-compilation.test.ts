import { describe, it, expect } from 'vitest';
import { compileToSQL } from '../src/compiler';
import type { Expr, QueryAST } from '../src/types';

describe('Expression Compilation', () => {
  describe('Comparison Operators', () => {
    it('compiles equality expressions', () => {
      const expr: Expr = {
        kind: 'eq',
        left: { kind: 'column', table: 'user', name: 'id' },
        right: { kind: 'literal', value: 1 },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe('SELECT * FROM "user" WHERE "user"."id" = 1');
      expect(result.params).toEqual([]);
    });

    it('compiles not equal expressions', () => {
      const expr: Expr = {
        kind: 'ne',
        left: { kind: 'column', name: 'active' },
        right: { kind: 'literal', value: false },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe('SELECT * FROM "user" WHERE "active" != false');
      expect(result.params).toEqual([]);
    });

    it('compiles greater than expressions', () => {
      const expr: Expr = {
        kind: 'gt',
        left: { kind: 'column', name: 'age' },
        right: { kind: 'literal', value: 18 },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe('SELECT * FROM "user" WHERE age > 18');
      expect(result.params).toEqual([]);
    });

    it('compiles less than expressions', () => {
      const expr: Expr = {
        kind: 'lt',
        left: { kind: 'column', name: 'score' },
        right: { kind: 'literal', value: 100 },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe('SELECT * FROM "user" WHERE score < 100');
      expect(result.params).toEqual([]);
    });

    it('compiles greater than or equal expressions', () => {
      const expr: Expr = {
        kind: 'gte',
        left: { kind: 'column', name: 'price' },
        right: { kind: 'literal', value: 10.5 },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'product',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe('SELECT * FROM product WHERE price >= 10.5');
      expect(result.params).toEqual([]);
    });

    it('compiles less than or equal expressions', () => {
      const expr: Expr = {
        kind: 'lte',
        left: { kind: 'column', name: 'quantity' },
        right: { kind: 'literal', value: 5 },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'inventory',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe('SELECT * FROM inventory WHERE quantity <= 5');
      expect(result.params).toEqual([]);
    });
  });

  describe('Logical Operators', () => {
    it('compiles AND expressions', () => {
      const expr: Expr = {
        kind: 'and',
        left: {
          kind: 'eq',
          left: { kind: 'column', name: 'active' },
          right: { kind: 'literal', value: true },
        },
        right: {
          kind: 'gt',
          left: { kind: 'column', name: 'age' },
          right: { kind: 'literal', value: 18 },
        },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe('SELECT * FROM "user" WHERE ("active" = true AND age > 18)');
      expect(result.params).toEqual([]);
    });

    it('compiles OR expressions', () => {
      const expr: Expr = {
        kind: 'or',
        left: {
          kind: 'eq',
          left: { kind: 'column', name: 'role' },
          right: { kind: 'literal', value: 'admin' },
        },
        right: {
          kind: 'eq',
          left: { kind: 'column', name: 'role' },
          right: { kind: 'literal', value: 'moderator' },
        },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe(
        "SELECT * FROM \"user\" WHERE (role = 'admin' OR role = 'moderator')",
      );
      expect(result.params).toEqual([]);
    });

    it('compiles nested logical expressions', () => {
      const expr: Expr = {
        kind: 'and',
        left: {
          kind: 'eq',
          left: { kind: 'column', name: 'active' },
          right: { kind: 'literal', value: true },
        },
        right: {
          kind: 'or',
          left: {
            kind: 'eq',
            left: { kind: 'column', name: 'role' },
            right: { kind: 'literal', value: 'admin' },
          },
          right: {
            kind: 'eq',
            left: { kind: 'column', name: 'role' },
            right: { kind: 'literal', value: 'user' },
          },
        },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe(
        'SELECT * FROM "user" WHERE ("active" = true AND (role = \'admin\' OR role = \'user\'))',
      );
      expect(result.params).toEqual([]);
    });
  });

  describe('Column References', () => {
    it('compiles column references with table prefix', () => {
      const expr: Expr = {
        kind: 'eq',
        left: { kind: 'column', table: 'user', name: 'id' },
        right: { kind: 'column', table: 'post', name: 'user_id' },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe('SELECT * FROM "user" WHERE "user"."id" = "post".user_id');
      expect(result.params).toEqual([]);
    });

    it('compiles column references without table prefix', () => {
      const expr: Expr = {
        kind: 'eq',
        left: { kind: 'column', name: 'id' },
        right: { kind: 'literal', value: 1 },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe('SELECT * FROM "user" WHERE "id" = 1');
      expect(result.params).toEqual([]);
    });
  });

  describe('Literal Values', () => {
    it('compiles string literals with proper escaping', () => {
      const expr: Expr = {
        kind: 'eq',
        left: { kind: 'column', name: 'name' },
        right: { kind: 'literal', value: "O'Connor" },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe("SELECT * FROM \"user\" WHERE name = 'O''Connor'");
      expect(result.params).toEqual([]);
    });

    it('compiles null literals', () => {
      const expr: Expr = {
        kind: 'eq',
        left: { kind: 'column', name: 'deleted_at' },
        right: { kind: 'literal', value: null },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe('SELECT * FROM "user" WHERE deleted_at = NULL');
      expect(result.params).toEqual([]);
    });

    it('compiles boolean literals', () => {
      const expr: Expr = {
        kind: 'eq',
        left: { kind: 'column', name: 'active' },
        right: { kind: 'literal', value: true },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe('SELECT * FROM "user" WHERE "active" = true');
      expect(result.params).toEqual([]);
    });

    it('compiles numeric literals', () => {
      const expr: Expr = {
        kind: 'eq',
        left: { kind: 'column', name: 'count' },
        right: { kind: 'literal', value: 42 },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'counter',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe('SELECT * FROM counter WHERE count = 42');
      expect(result.params).toEqual([]);
    });
  });

  describe('Complex Expressions', () => {
    it('compiles complex nested expressions', () => {
      const expr: Expr = {
        kind: 'and',
        left: {
          kind: 'or',
          left: {
            kind: 'eq',
            left: { kind: 'column', name: 'status' },
            right: { kind: 'literal', value: 'active' },
          },
          right: {
            kind: 'eq',
            left: { kind: 'column', name: 'status' },
            right: { kind: 'literal', value: 'pending' },
          },
        },
        right: {
          kind: 'gte',
          left: { kind: 'column', name: 'score' },
          right: { kind: 'literal', value: 80 },
        },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.sql).toBe(
        "SELECT * FROM \"user\" WHERE ((status = 'active' OR status = 'pending') AND score >= 80)",
      );
      expect(result.params).toEqual([]);
    });
  });

  describe('Parameter Count Calculation', () => {
    it('calculates parameter count for expressions with parameters', () => {
      // This test would be relevant if we had parameterized expressions
      // For now, all our expressions use literals, so param count should be 0
      const expr: Expr = {
        kind: 'and',
        left: {
          kind: 'eq',
          left: { kind: 'column', name: 'id' },
          right: { kind: 'literal', value: 1 },
        },
        right: {
          kind: 'eq',
          left: { kind: 'column', name: 'active' },
          right: { kind: 'literal', value: true },
        },
      };

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      const result = compileToSQL(query);
      expect(result.params).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('throws error for unknown expression kinds', () => {
      const expr = {
        kind: 'unknown',
        left: { kind: 'column', name: 'id' },
        right: { kind: 'literal', value: 1 },
      } as any;

      const query: QueryAST = {
        type: 'select',
        from: 'user',
        where: { type: 'where', condition: expr },
      };

      expect(() => compileToSQL(query)).toThrow('Unknown expression kind: unknown');
    });
  });
});
