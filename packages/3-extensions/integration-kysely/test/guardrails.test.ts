import { describe, expect, it } from 'vitest';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from '../src/transform/errors';
import { runGuardrails } from '../src/transform/guardrails';
import { compileQuery, compilerDb, contract } from './transform.fixtures';

function cloneQuery<T>(query: T): T {
  return JSON.parse(JSON.stringify(query)) as T;
}

describe('runGuardrails', () => {
  describe('qualified-ref check', () => {
    it('rejects unqualified column ref in multi-table selections', () => {
      const compiled = compileQuery(
        compilerDb
          .selectFrom('user as u')
          .leftJoin('post as p', 'u.id', 'p.userId')
          .select(['u.id']),
      );
      const query = cloneQuery(compiled.query) as unknown as {
        selections: Array<{ selection: { table?: unknown } }>;
      };
      delete query.selections[0]?.selection.table;

      expect(() => runGuardrails(contract, query)).toThrow(KyselyTransformError);
      try {
        runGuardrails(contract, query);
      } catch (error) {
        expect((error as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
        );
      }
    });

    it('rejects unqualified column ref in multi-table where.where', () => {
      const compiled = compileQuery(
        compilerDb
          .selectFrom('user as u')
          .leftJoin('post as p', 'u.id', 'p.userId')
          .selectAll('u')
          .where('u.id', '=', 'u1'),
      );
      const query = cloneQuery(compiled.query) as unknown as {
        where?: { where?: { leftOperand?: { table?: unknown } } };
      };
      delete query.where?.where?.leftOperand?.table;

      expect(() => runGuardrails(contract, query)).toThrow(KyselyTransformError);
      try {
        runGuardrails(contract, query);
      } catch (error) {
        expect((error as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
        );
      }
    });

    it('rejects unqualified column ref in multi-table orderBy items', () => {
      const compiled = compileQuery(
        compilerDb
          .selectFrom('user as u')
          .leftJoin('post as p', 'u.id', 'p.userId')
          .selectAll('u')
          .orderBy('u.email', 'asc'),
      );
      const query = cloneQuery(compiled.query) as unknown as {
        orderBy?: { items?: Array<{ orderBy?: { table?: unknown } }> };
      };
      delete query.orderBy?.items?.[0]?.orderBy?.table;

      expect(() => runGuardrails(contract, query)).toThrow(KyselyTransformError);
      try {
        runGuardrails(contract, query);
      } catch (error) {
        expect((error as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
        );
      }
    });

    it('allows qualified column refs in multi-table scope', () => {
      const compiled = compileQuery(
        compilerDb
          .selectFrom('user as u')
          .leftJoin('post as p', 'u.id', 'p.userId')
          .select(['u.id', 'p.userId']),
      );

      expect(() => runGuardrails(contract, compiled.query)).not.toThrow();
    });

    it('allows unqualified refs in single-table scope', () => {
      const compiled = compileQuery(compilerDb.selectFrom('user').select(['id']));

      expect(() => runGuardrails(contract, compiled.query)).not.toThrow();
    });

    it('rejects unqualified ref in multi-FROM scope (froms.length > 1)', () => {
      const compiled = compileQuery(compilerDb.selectFrom('user').select(['id']));
      const query = cloneQuery(compiled.query) as unknown as {
        from?: { froms?: unknown[] };
      };
      query.from?.froms?.push({
        kind: 'TableNode',
        table: {
          kind: 'SchemableIdentifierNode',
          identifier: { kind: 'IdentifierNode', name: 'post' },
        },
      });

      expect(() => runGuardrails(contract, query)).toThrow(KyselyTransformError);
      try {
        runGuardrails(contract, query);
      } catch (error) {
        expect((error as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
        );
      }
    });
  });

  describe('ambiguous selectAll check', () => {
    it('rejects selectAll without table reference in multi-table scope', () => {
      const compiled = compileQuery(
        compilerDb.selectFrom('user as u').leftJoin('post as p', 'u.id', 'p.userId').selectAll(),
      );

      expect(() => runGuardrails(contract, compiled.query)).toThrow(KyselyTransformError);
      try {
        runGuardrails(contract, compiled.query);
      } catch (error) {
        expect((error as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.AMBIGUOUS_SELECT_ALL,
        );
      }
    });

    it('allows selectAll with explicit table in multi-table scope', () => {
      const compiled = compileQuery(
        compilerDb.selectFrom('user as u').leftJoin('post as p', 'u.id', 'p.userId').selectAll('u'),
      );

      expect(() => runGuardrails(contract, compiled.query)).not.toThrow();
    });

    it('allows selectAll in single-table scope', () => {
      const compiled = compileQuery(compilerDb.selectFrom('user').selectAll());

      expect(() => runGuardrails(contract, compiled.query)).not.toThrow();
    });
  });

  describe('non-select queries', () => {
    it('passes through InsertQueryNode without guardrail checks', () => {
      const compiled = compileQuery(
        compilerDb
          .insertInto('user')
          .values({ id: 'u1', email: 'u1@test', createdAt: '2024-01-01' }),
      );

      expect(() => runGuardrails(contract, compiled.query)).not.toThrow();
    });

    it('passes through UpdateQueryNode without guardrail checks', () => {
      const compiled = compileQuery(compilerDb.updateTable('user').set({ email: 'x' }));

      expect(() => runGuardrails(contract, compiled.query)).not.toThrow();
    });

    it('passes through DeleteQueryNode without guardrail checks', () => {
      const compiled = compileQuery(compilerDb.deleteFrom('user'));

      expect(() => runGuardrails(contract, compiled.query)).not.toThrow();
    });
  });
});
