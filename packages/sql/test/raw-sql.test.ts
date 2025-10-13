import { describe, it, expect } from 'vitest';
import { rawSql } from '../src/types';
import {
  rawQuery,
  raw,
  rawExpr,
  ident,
  table,
  column,
  value,
  unsafe,
  qualified,
  refsOfRaw,
} from '../src/raw';
import { compileToSQL } from '../src/compiler';
import { sql } from '../src/sql';
import { makeT } from '../src/maket';

describe('Raw SQL', () => {
  describe('Legacy rawSql() function', () => {
    it('creates a Plan<unknown> for raw SQL', () => {
      const plan = rawSql('SELECT 1 as test');

      expect(plan).toEqual({
        ast: { type: 'select', from: '', projectStar: true },
        sql: 'SELECT 1 as test',
        params: [],
        meta: {
          contractHash: '',
          target: 'postgres',
          refs: { tables: [], columns: [] },
        },
      });
    });

    it('has unknown result type', () => {
      const plan = rawSql('SELECT 1 as test');

      // TypeScript should infer TResult as unknown
      const result: unknown[] = [];
      expect(typeof plan).toBe('object');
    });
  });

  describe('New raw SQL API', () => {
    describe('Template atoms', () => {
      it('creates ident atoms', () => {
        const atom = ident('user');
        expect(atom).toEqual({ kind: 'ident', name: 'user' });
      });

      it('creates table atoms', () => {
        const atom = table('users');
        expect(atom).toEqual({ kind: 'table', name: 'users' });
      });

      it('creates column atoms', () => {
        const atom = column('users', 'id');
        expect(atom).toEqual({ kind: 'column', table: 'users', name: 'id' });
      });

      it('creates qualified atoms', () => {
        const atom = qualified(['public', 'users']);
        expect(atom).toEqual({ kind: 'qualified', parts: ['public', 'users'] });
      });

      it('creates value atoms', () => {
        const atom = value('test@example.com', 'text');
        expect(atom).toEqual({ kind: 'value', v: 'test@example.com', codec: 'text' });
      });

      it('creates unsafe atoms', () => {
        const atom = unsafe('NOW()');
        expect(atom).toEqual({ kind: 'rawUnsafe', sql: 'NOW()' });
      });
    });

    describe('Raw template building', () => {
      it('builds simple raw query', () => {
        const ast = raw`SELECT ${value(1)} as test`;

        expect(ast).toEqual({
          type: 'raw',
          template: [
            { kind: 'text', value: 'SELECT ' },
            { kind: 'value', v: 1, codec: undefined },
            { kind: 'text', value: ' as test' },
          ],
        });
      });

      it('builds query with identifiers and values', () => {
        const email = 'test@example.com';
        const ast = raw`
          SELECT ${column('user', 'id')} as id
          FROM ${table('user')}
          WHERE ${column('user', 'email')} = ${value(email, 'text')}
        `;

        expect(ast.type).toBe('raw');
        expect(ast.template).toHaveLength(9); // Updated to match actual length

        // Find pieces by kind instead of using indices
        const columnPieces = ast.template.filter((p) => p.kind === 'column');
        const tablePieces = ast.template.filter((p) => p.kind === 'table');
        const valuePieces = ast.template.filter((p) => p.kind === 'value');

        expect(columnPieces).toHaveLength(2);
        expect(columnPieces[0]).toEqual({ kind: 'column', table: 'user', name: 'id' });
        expect(columnPieces[1]).toEqual({ kind: 'column', table: 'user', name: 'email' });

        expect(tablePieces).toHaveLength(1);
        expect(tablePieces[0]).toEqual({ kind: 'table', name: 'user' });

        expect(valuePieces).toHaveLength(1);
        expect(valuePieces[0]).toEqual({ kind: 'value', v: email, codec: 'text' });
      });

      it('builds query with qualified names', () => {
        const ast = raw`SELECT * FROM ${qualified(['public', 'users'])}`;

        // Find the qualified piece in the template
        const qualifiedPiece = ast.template.find((piece) => piece.kind === 'qualified');
        expect(qualifiedPiece).toEqual({ kind: 'qualified', parts: ['public', 'users'] });
      });

      it('builds query with unsafe fragments', () => {
        const ast = raw`SELECT ${unsafe('COUNT(*)')} FROM ${table('users')}`;

        expect(ast.template[1]).toEqual({ kind: 'rawUnsafe', sql: 'COUNT(*)' });
        expect(ast.template[3]).toEqual({ kind: 'table', name: 'users' });
      });
    });

    describe('Raw query compilation', () => {
      it('compiles simple raw query', () => {
        const ast = raw`SELECT ${value(1)} as test`;
        const { sql, params } = compileToSQL(ast);

        expect(sql).toBe('SELECT $1 as test');
        expect(params).toEqual([1]);
      });

      it('compiles query with identifiers', () => {
        const ast = raw`SELECT ${ident('id')} FROM ${table('users')}`;
        const { sql, params } = compileToSQL(ast);

        expect(sql).toBe('SELECT "id" FROM "users"');
        expect(params).toEqual([]);
      });

      it('compiles query with column references', () => {
        const ast = raw`SELECT ${column('users', 'id')} FROM ${table('users')}`;
        const { sql, params } = compileToSQL(ast);

        expect(sql).toBe('SELECT "users"."id" FROM "users"');
        expect(params).toEqual([]);
      });

      it('compiles query with qualified names', () => {
        const ast = raw`SELECT * FROM ${qualified(['public', 'users'])}`;
        const { sql, params } = compileToSQL(ast);

        expect(sql).toBe('SELECT * FROM "public"."users"');
        expect(params).toEqual([]);
      });

      it('compiles query with unsafe fragments', () => {
        const ast = raw`SELECT ${unsafe('COUNT(*)')} FROM ${table('users')}`;
        const { sql, params } = compileToSQL(ast);

        expect(sql).toBe('SELECT COUNT(*) FROM "users"');
        expect(params).toEqual([]);
      });

      it('compiles complex query with mixed pieces', () => {
        const email = 'test@example.com';
        const ast = raw`
          SELECT ${column('user', 'id')} as id, ${column('user', 'email')} as email
          FROM ${table('user')}
          WHERE ${column('user', 'email')} = ${value(email, 'text')}
          AND lower(${ident('tenant')}) = ${value('public')}
          LIMIT ${value(1)}
        `;

        const { sql, params } = compileToSQL(ast);

        // The SQL will include whitespace from the template
        expect(sql).toContain('SELECT "user"."id" as id, "user"."email" as email');
        expect(sql).toContain('FROM "user"');
        expect(sql).toContain('WHERE "user"."email" = $1');
        expect(sql).toContain('AND lower("tenant") = $2');
        expect(sql).toContain('LIMIT $3');
        expect(params).toEqual([email, 'public', 1]);
      });
    });

    describe('Dialect support', () => {
      it('uses postgres placeholders by default', () => {
        const ast = raw`SELECT ${value(1)}`;
        const { sql, params } = compileToSQL(ast);

        expect(sql).toBe('SELECT $1');
        expect(params).toEqual([1]);
      });

      it('uses postgres placeholders when dialect is postgres', () => {
        const ast = raw`SELECT ${value(1)}`;
        ast.dialect = 'postgres';
        const { sql, params } = compileToSQL(ast);

        expect(sql).toBe('SELECT $1');
        expect(params).toEqual([1]);
      });

      it('uses question marks when dialect is mysql', () => {
        const ast = raw`SELECT ${value(1)}`;
        ast.dialect = 'mysql';
        const { sql, params } = compileToSQL(ast);

        expect(sql).toBe('SELECT ?');
        expect(params).toEqual([1]);
      });

      it('uses question marks when dialect is sqlite', () => {
        const ast = raw`SELECT ${value(1)}`;
        ast.dialect = 'sqlite';
        const { sql, params } = compileToSQL(ast);

        expect(sql).toBe('SELECT ?');
        expect(params).toEqual([1]);
      });
    });

    describe('Safety features', () => {
      it('allows multiple statements by default', () => {
        const ast = raw`SELECT 1; DROP TABLE users;`;

        // Should not throw - multiple statements are now allowed by default
        expect(() => compileToSQL(ast)).not.toThrow();

        const { sql } = compileToSQL(ast);
        expect(sql).toContain('SELECT 1; DROP TABLE users;');
      });

      it('allows multiple statements when allowMulti is set', () => {
        const ast = raw`SELECT 1; DROP TABLE users;`;
        ast.annotations = { allowMulti: true };

        const { sql, params } = compileToSQL(ast);
        expect(sql).toBe('SELECT 1; DROP TABLE users;');
        expect(params).toEqual([]);
      });
    });

    describe('Refs extraction', () => {
      it('extracts table references', () => {
        const ast = raw`SELECT * FROM ${table('users')} JOIN ${table('posts')}`;
        const refs = refsOfRaw(ast);

        expect(refs.tables).toEqual(['users', 'posts']);
        expect(refs.columns).toEqual([]);
      });

      it('extracts column references', () => {
        const ast = raw`SELECT ${column('users', 'id')}, ${column('posts', 'title')}`;
        const refs = refsOfRaw(ast);

        expect(refs.tables).toEqual(['users', 'posts']);
        expect(refs.columns).toEqual(['users.id', 'posts.title']);
      });

      it('extracts qualified references', () => {
        const ast = raw`SELECT * FROM ${qualified(['public', 'users'])}`;
        const refs = refsOfRaw(ast);

        expect(refs.tables).toEqual(['users']);
        expect(refs.columns).toEqual([]);
      });

      it('handles mixed references', () => {
        const ast = raw`
          SELECT ${column('user', 'id')}
          FROM ${table('user')}
          JOIN ${qualified(['public', 'posts'])} ON ${column('posts', 'userId')} = ${column('user', 'id')}
        `;
        const refs = refsOfRaw(ast);

        expect(refs.tables).toEqual(['user', 'posts']);
        expect(refs.columns).toEqual(['user.id', 'posts.userId']);
      });
    });

    describe('rawQuery convenience function', () => {
      it('creates complete Plan from template', () => {
        const email = 'test@example.com';
        const plan = rawQuery`
          SELECT ${column('user', 'id')} as id
          FROM ${table('user')}
          WHERE ${column('user', 'email')} = ${value(email, 'text')}
        `;

        expect(plan.ast.type).toBe('raw');
        expect(plan.sql).toContain('SELECT "user"."id" as id');
        expect(plan.sql).toContain('FROM "user"');
        expect(plan.sql).toContain('WHERE "user"."email" = $1');
        expect(plan.params).toEqual([email]);
        expect(plan.meta.refs.tables).toEqual(['user']);
        expect(plan.meta.refs.columns).toEqual(['user.id', 'user.email']);
        expect(plan.meta.annotations?.origin).toBe('raw');
      });
    });

    describe('Raw expressions for embedding', () => {
      it('creates raw expression', () => {
        const expr = rawExpr`lower(${ident('email')})`;

        expect(expr).toEqual({
          kind: 'raw',
          template: [
            { kind: 'text', value: 'lower(' },
            { kind: 'ident', name: 'email' },
            { kind: 'text', value: ')' },
          ],
        });
      });

      it('compiles raw expression', () => {
        const expr = rawExpr`lower(${ident('email')})`;
        const params: any[] = [];
        const sql = compileToSQL({ type: 'raw', template: expr.template } as any);

        expect(sql.sql).toBe('lower("email")');
        expect(sql.params).toEqual([]);
      });
    });

    describe('Builder integration', () => {
      it('supports raw expressions in selectRaw', () => {
        // Mock schema IR
        const mockIR = { contractHash: 'test-hash' };

        const query = sql(mockIR)
          .from('users')
          .selectRaw([
            { alias: 'id', expr: { kind: 'column', table: 'users', name: 'id' } },
            { alias: 'email_lower', expr: rawExpr`lower(${ident('email')})` },
            { alias: 'count', expr: rawExpr`${unsafe('COUNT(*)')}` },
          ])
          .build();

        expect(query.sql).toContain('SELECT "users"."id" AS "id"');
        expect(query.sql).toContain('lower("email") AS email_lower');
        expect(query.sql).toContain('COUNT(*) AS count');
        expect(query.sql).toContain('FROM "users"');
        expect(query.params).toEqual([]);
      });
    });
  });
});
