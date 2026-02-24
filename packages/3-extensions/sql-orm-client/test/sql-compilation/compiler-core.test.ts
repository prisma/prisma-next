import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  compileDeleteCount,
  compileDeleteReturning,
  compileRelationSelect,
  compileSelect,
  compileUpdateCount,
  compileUpdateReturning,
} from '../../src/kysely-compiler';
import { emptyState } from '../../src/types';
import { normalizeSql } from './helpers';

function stateWithFilters(filters: readonly WhereExpr[]) {
  return {
    ...emptyState(),
    filters,
  };
}

describe('sql-compilation/compiler-core', () => {
  it('compileUpdateReturning and compileDeleteReturning support no-filter mutations', () => {
    const updateCompiled = compileUpdateReturning('users', { name: 'A' }, [], ['id']);
    const updateReturningAll = compileUpdateReturning('users', { name: 'B' }, [], undefined);
    const deleteCompiled = compileDeleteReturning('users', [], ['id']);
    const deleteReturningAll = compileDeleteReturning('users', [], undefined);

    expect(normalizeSql(updateCompiled.sql)).toBe('update "users" set "name" = $1 returning "id"');
    expect(normalizeSql(updateReturningAll.sql)).toBe('update "users" set "name" = $1 returning *');

    expect(normalizeSql(deleteCompiled.sql)).toBe('delete from "users" returning "id"');
    expect(normalizeSql(deleteReturningAll.sql)).toBe('delete from "users" returning *');
  });

  it('compileUpdateCount and compileDeleteCount support no-filter mutations', () => {
    const updateCompiled = compileUpdateCount('users', { name: 'A' }, []);
    const deleteCompiled = compileDeleteCount('users', []);

    expect(updateCompiled.sql.toLowerCase()).toBe('update "users" set "name" = $1');
    expect(updateCompiled.parameters).toEqual(['A']);

    expect(deleteCompiled.sql.toLowerCase()).toBe('delete from "users"');
    expect(deleteCompiled.parameters).toEqual([]);
  });

  it('compileSelect compiles null checks and exists predicates', () => {
    const nullCheckState = stateWithFilters([
      {
        kind: 'nullCheck',
        expr: { kind: 'col', table: 'users', column: 'email' },
        isNull: false,
      },
    ]);

    const existsState = stateWithFilters([
      {
        kind: 'exists',
        not: true,
        subquery: {
          kind: 'select',
          from: { kind: 'table', name: 'posts' },
          project: [{ alias: '_exists', expr: { kind: 'literal', value: 1 } }],
          where: {
            kind: 'bin',
            op: 'eq',
            left: { kind: 'col', table: 'posts', column: 'user_id' },
            right: { kind: 'col', table: 'users', column: 'id' },
          },
        },
      },
    ]);

    const nullCheck = compileSelect('users', nullCheckState);
    const exists = compileSelect('users', existsState);

    expect(normalizeSql(nullCheck.sql)).toBe(
      'select * from "users" where "users"."email" is not null',
    );
    expect(normalizeSql(exists.sql)).toBe(
      'select * from "users" where not (exists ((select $1 as "_exists" from "posts" where "posts"."user_id" = "users"."id")))',
    );
  });

  it('compileSelect compiles OR filters, is-null checks, and scalar IN literals', () => {
    const orState = stateWithFilters([
      {
        kind: 'or',
        exprs: [
          {
            kind: 'bin',
            op: 'eq',
            left: { kind: 'col', table: 'users', column: 'id' },
            right: { kind: 'literal', value: 1 },
          },
          {
            kind: 'bin',
            op: 'eq',
            left: { kind: 'col', table: 'users', column: 'id' },
            right: { kind: 'literal', value: 2 },
          },
        ],
      },
      {
        kind: 'nullCheck',
        expr: { kind: 'col', table: 'users', column: 'email' },
        isNull: true,
      },
      {
        kind: 'bin',
        op: 'in',
        left: { kind: 'col', table: 'users', column: 'id' },
        right: { kind: 'literal', value: 3 },
      },
    ]);

    const compiled = compileSelect('users', orState);
    expect(normalizeSql(compiled.sql)).toContain('("users"."id" = $1 or "users"."id" = $2)');
    expect(normalizeSql(compiled.sql)).toContain('"users"."email" is null');
    expect(normalizeSql(compiled.sql)).toContain('"users"."id" in ($3)');
  });

  it('compileSelect supports list literals and array literals for in/not in', () => {
    const listLiteralState = stateWithFilters([
      {
        kind: 'bin',
        op: 'in',
        left: { kind: 'col', table: 'users', column: 'id' },
        right: {
          kind: 'listLiteral',
          values: [
            { kind: 'literal', value: 1 },
            { kind: 'literal', value: 2 },
          ],
        },
      },
    ]);

    const arrayLiteralState = stateWithFilters([
      {
        kind: 'bin',
        op: 'notIn',
        left: { kind: 'col', table: 'users', column: 'id' },
        right: { kind: 'literal', value: [3, 4] },
      },
    ]);

    const listLiteral = compileSelect('users', listLiteralState);
    const arrayLiteral = compileSelect('users', arrayLiteralState);

    expect(normalizeSql(listLiteral.sql)).toBe(
      'select * from "users" where "users"."id" in ($1, $2)',
    );
    expect(listLiteral.parameters).toEqual([1, 2]);

    expect(normalizeSql(arrayLiteral.sql)).toBe(
      'select * from "users" where "users"."id" not in ($1, $2)',
    );
    expect(arrayLiteral.parameters).toEqual([3, 4]);
  });

  it('compileSelect throws for unsupported cursor and expression forms', () => {
    const missingCursorValueState = {
      ...emptyState(),
      orderBy: [
        { column: 'name', direction: 'asc' as const },
        { column: 'email', direction: 'asc' as const },
      ],
      cursor: { name: 'Alice' },
    };

    const nonInListState = stateWithFilters([
      {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: 'users', column: 'id' },
        right: {
          kind: 'listLiteral',
          values: [{ kind: 'literal', value: 1 }],
        },
      },
    ]);

    const paramState = stateWithFilters([
      {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: 'users', column: 'id' },
        right: { kind: 'param', index: 0, name: 'id' },
      },
    ]);

    const operationExpr = {
      kind: 'operation',
      method: 'lower',
      forTypeId: 'pg/text@1',
      self: { kind: 'col', table: 'users', column: 'name' },
      args: [],
      returns: { kind: 'value', type: 'string' },
      lowering: { kind: 'raw', sql: 'lower(?)' },
    } as never;

    const operationState = stateWithFilters([
      {
        kind: 'bin',
        op: 'eq',
        left: operationExpr,
        right: { kind: 'literal', value: 'alice' },
      } as unknown as WhereExpr,
    ]);

    expect(() => compileSelect('users', missingCursorValueState)).toThrow(
      /Missing cursor value for orderBy column "email"/,
    );
    expect(() => compileSelect('users', nonInListState)).toThrow(/does not support list literals/);
    expect(() => compileSelect('users', paramState)).toThrow(/ParamRef "id" is not supported/);
    expect(() => compileSelect('users', operationState)).toThrow(
      /Operation expressions are not yet supported in orm-client filters/,
    );
  });

  it('compileSelect throws for unsupported subquery projection and orderBy forms', () => {
    const includeRefState = stateWithFilters([
      {
        kind: 'exists',
        not: false,
        subquery: {
          kind: 'select',
          from: { kind: 'table', name: 'posts' },
          project: [{ alias: 'posts', expr: { kind: 'includeRef', alias: 'posts' } }],
        },
      } as unknown as WhereExpr,
    ]);

    const operationOrderByState = stateWithFilters([
      {
        kind: 'exists',
        not: false,
        subquery: {
          kind: 'select',
          from: { kind: 'table', name: 'posts' },
          project: [{ alias: '_exists', expr: { kind: 'literal', value: 1 } }],
          orderBy: [
            {
              expr: {
                kind: 'operation',
                method: 'lower',
                forTypeId: 'pg/text@1',
                self: { kind: 'col', table: 'posts', column: 'title' },
                args: [],
                returns: { kind: 'value', type: 'string' },
                lowering: { kind: 'raw', sql: 'lower(?)' },
              },
              dir: 'asc',
            },
          ],
        },
      } as unknown as WhereExpr,
    ]);

    expect(() => compileSelect('users', includeRefState)).toThrow(
      /Include refs are not supported inside EXISTS subqueries/,
    );
    expect(() => compileSelect('users', operationOrderByState)).toThrow(
      /Operation expressions are not supported in subquery orderBy clauses/,
    );
  }, 1_000);

  it('compileSelect supports subquery projection defaults, column projections, and limits', () => {
    const projectedColumnState = stateWithFilters([
      {
        kind: 'exists',
        not: false,
        subquery: {
          kind: 'select',
          from: { kind: 'table', name: 'posts' },
          project: [{ expr: { kind: 'col', table: 'posts', column: 'id' } }],
          orderBy: [{ expr: { kind: 'col', table: 'posts', column: 'id' }, dir: 'asc' }],
          limit: 1,
        },
      } as unknown as WhereExpr,
    ]);

    const emptyProjectionState = stateWithFilters([
      {
        kind: 'exists',
        not: false,
        subquery: {
          kind: 'select',
          from: { kind: 'table', name: 'posts' },
          project: [],
        },
      },
    ]);

    const projectedColumn = compileSelect('users', projectedColumnState);
    const emptyProjection = compileSelect('users', emptyProjectionState);

    expect(normalizeSql(projectedColumn.sql)).toContain(
      'exists ((select "posts"."id" as "_p0" from "posts" order by "posts"."id" asc limit $1))',
    );
    expect(projectedColumn.parameters).toEqual([1]);

    expect(normalizeSql(emptyProjection.sql)).toContain(
      'exists ((select 1 as "_exists" from "posts"))',
    );
  });

  it('compileSelect supports all join types in EXISTS subqueries', () => {
    for (const joinType of ['inner', 'left', 'right', 'full'] as const) {
      const joinState = stateWithFilters([
        {
          kind: 'exists',
          not: false,
          subquery: {
            kind: 'select',
            from: { kind: 'table', name: 'posts' },
            joins: [
              {
                kind: 'join',
                joinType,
                table: { kind: 'table', name: 'users' },
                on: {
                  kind: 'eqCol',
                  left: { kind: 'col', table: 'posts', column: 'user_id' },
                  right: { kind: 'col', table: 'users', column: 'id' },
                },
              },
            ],
            project: [{ alias: '_exists', expr: { kind: 'literal', value: 1 } }],
          },
        },
      ]);

      const compiled = compileSelect('users', joinState);
      expect(normalizeSql(compiled.sql)).toBe(
        `select * from "users" where exists ((select $1 as "_exists" from "posts" ${joinType} join "users" on "posts"."user_id" = "users"."id"))`,
      );
    }
  });

  it('compileSelect throws for unsupported join type and where kind', () => {
    const badJoinState = stateWithFilters([
      {
        kind: 'exists',
        not: false,
        subquery: {
          kind: 'select',
          from: { kind: 'table', name: 'posts' },
          joins: [
            {
              kind: 'join',
              joinType: 'cross',
              table: { kind: 'table', name: 'users' },
              on: {
                kind: 'eqCol',
                left: { kind: 'col', table: 'posts', column: 'user_id' },
                right: { kind: 'col', table: 'users', column: 'id' },
              },
            },
          ],
          project: [{ alias: '_exists', expr: { kind: 'literal', value: 1 } }],
        },
      } as unknown as WhereExpr,
    ]);

    const badWhereState = {
      ...emptyState(),
      filters: [{ kind: 'unexpected' } as unknown as WhereExpr],
    };

    expect(() => compileSelect('users', badJoinState)).toThrow(/Unsupported join type/);
    expect(() => compileSelect('users', badWhereState)).toThrow(
      /Unsupported where expression kind/,
    );
  });

  it('compileSelect throws for unsupported expression and SQL comparable kinds', () => {
    const unsupportedExpressionState = stateWithFilters([
      {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'unknown' } as never,
        right: { kind: 'literal', value: 1 },
      } as never,
    ]);

    const unsupportedComparableState = stateWithFilters([
      {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: 'users', column: 'id' },
        right: { kind: 'unknown' } as never,
      } as never,
    ]);

    const unnamedParamState = stateWithFilters([
      {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: 'users', column: 'id' },
        right: { kind: 'param', index: 3 },
      } as never,
    ]);

    expect(() => compileSelect('users', unsupportedExpressionState)).toThrow(
      /Unsupported expression kind/,
    );
    expect(() => compileSelect('users', unsupportedComparableState)).toThrow(
      /Unsupported SQL comparable kind/,
    );
    expect(() => compileSelect('users', unnamedParamState)).toThrow(
      /ParamRef "3" is not supported/,
    );
  });

  it('compileRelationSelect applies nested filters/order/distinct/cursor', () => {
    const compiled = compileRelationSelect('posts', 'user_id', [1, 2], {
      ...emptyState(),
      distinctOn: ['user_id'],
      selectedFields: ['id', 'user_id'],
      filters: [
        {
          kind: 'bin',
          op: 'gt',
          left: { kind: 'col', table: 'posts', column: 'views' },
          right: { kind: 'literal', value: 100 },
        },
      ],
      orderBy: [{ column: 'id', direction: 'desc' }],
      cursor: { id: 10 },
    });

    expect(normalizeSql(compiled.sql)).toBe(
      'select distinct on ("posts"."user_id") "posts"."id", "posts"."user_id" from "posts" where "user_id" in ($1, $2) and "posts"."views" > $3 and "posts"."id" < $4 order by "id" desc',
    );
    expect(compiled.parameters).toEqual([1, 2, 100, 10]);
  });
});
