import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { transformKyselyToPnAst } from '../src/transform/transform';
import { compileQuery, compilerDb, contract } from './transform.fixtures';

describe('transformKyselyToPnAst — SelectQueryNode', () => {
  it('transforms simple selectAll query compiled by Kysely', () => {
    const compiled = compileQuery(compilerDb.selectFrom('user').selectAll());

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const selectAst = result.ast as SelectAst;

    expect(selectAst.kind).toBe('select');
    expect(selectAst.from).toEqual({ kind: 'table', name: 'user' });
    expect(selectAst.project).toHaveLength(3);
    expect(selectAst.selectAllIntent).toEqual({ table: 'user' });
    expect(result.metaAdditions.refs.tables).toContain('user');
  });

  it('transforms where with parameter descriptors from compiled query', () => {
    const compiled = compileQuery(
      compilerDb.selectFrom('user').selectAll().where('id', '=', 'user_123'),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const selectAst = result.ast as SelectAst;

    expect(selectAst.where).toMatchObject({
      kind: 'bin',
      op: 'eq',
      left: { kind: 'col', table: 'user', column: 'id' },
      right: { kind: 'param', index: 1 },
    });
    expect(result.metaAdditions.paramDescriptors).toHaveLength(1);
    expect(result.metaAdditions.paramDescriptors[0]).toMatchObject({
      source: 'lane',
      refs: { table: 'user', column: 'id' },
    });
  });

  it('transforms LIKE and IN predicates from compiled query', () => {
    const likeCompiled = compileQuery(
      compilerDb.selectFrom('user').selectAll().where('email', 'like', '%@test.com'),
    );
    const likeResult = transformKyselyToPnAst(
      contract,
      likeCompiled.query,
      likeCompiled.parameters,
    );

    expect((likeResult.ast as SelectAst).where).toMatchObject({
      kind: 'bin',
      op: 'like',
      left: { kind: 'col', table: 'user', column: 'email' },
    });

    const inCompiled = compileQuery(
      compilerDb.selectFrom('user').selectAll().where('id', 'in', ['a', 'b', 'c']),
    );
    const inResult = transformKyselyToPnAst(contract, inCompiled.query, inCompiled.parameters);
    const inAst = inResult.ast as SelectAst;

    expect(inAst.where).toMatchObject({
      kind: 'bin',
      op: 'in',
      left: { kind: 'col', table: 'user', column: 'id' },
      right: { kind: 'listLiteral', values: expect.any(Array) },
    });
    const listValues = ((inAst.where as { right?: { values?: unknown[] } })?.right?.values ??
      []) as unknown[];
    expect(listValues).toHaveLength(3);
  });

  it('maps `not in` operator from real Kysely operator spelling', () => {
    const compiled = compileQuery(
      compilerDb.selectFrom('user as u').select(['u.id']).where('u.id', 'not in', ['a', 'b']),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const selectAst = result.ast as SelectAst;

    expect(selectAst.where).toMatchObject({
      kind: 'bin',
      op: 'notIn',
      left: { kind: 'col', table: 'user', column: 'id' },
    });
  });

  it('normalizes binary-tree AND/OR into PN arrays', () => {
    const compiled = compileQuery(
      compilerDb
        .selectFrom('user')
        .select(['id'])
        .where((eb) =>
          eb.and([
            eb('id', '=', 'u1'),
            eb('email', 'like', '%@x.com'),
            eb.or([eb('id', '=', 'u2'), eb('id', '=', 'u3')]),
          ]),
        ),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const selectAst = result.ast as SelectAst;

    expect(selectAst.where?.kind).toBe('and');
    const andExprs = ((selectAst.where as { exprs?: unknown[] })?.exprs ?? []) as unknown[];
    expect(andExprs).toHaveLength(3);
    expect((andExprs[2] as { kind?: string }).kind).toBe('or');
  });

  it('handles ON.on shape, alias resolution, and left join mapping', () => {
    const compiled = compileQuery(
      compilerDb
        .selectFrom('user as u')
        .leftJoin('post as p', 'u.id', 'p.userId')
        .select(['u.id as userId', 'p.userId as postUserId'])
        .where('u.id', '=', 'u_1'),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const selectAst = result.ast as SelectAst;

    expect(selectAst.joins).toHaveLength(1);
    expect(selectAst.joins?.[0]).toMatchObject({
      kind: 'join',
      joinType: 'left',
      table: { kind: 'table', name: 'post' },
    });
    expect(selectAst.joins?.[0]?.on).toMatchObject({
      kind: 'eqCol',
      left: { kind: 'col', table: 'user', column: 'id' },
      right: { kind: 'col', table: 'post', column: 'userId' },
    });

    expect(selectAst.project).toEqual(
      expect.arrayContaining([
        {
          alias: 'userId',
          expr: { kind: 'col', table: 'user', column: 'id' },
        },
        {
          alias: 'postUserId',
          expr: { kind: 'col', table: 'post', column: 'userId' },
        },
      ]),
    );

    expect(selectAst.where).toMatchObject({
      kind: 'bin',
      left: { kind: 'col', table: 'user', column: 'id' },
    });
  });

  it('maps real joinType values for right/full joins', () => {
    const rightCompiled = compileQuery(
      compilerDb.selectFrom('user').rightJoin('post', 'user.id', 'post.userId').selectAll('user'),
    );
    const rightResult = transformKyselyToPnAst(
      contract,
      rightCompiled.query,
      rightCompiled.parameters,
    );
    expect((rightResult.ast as SelectAst).joins?.[0]?.joinType).toBe('right');

    const fullCompiled = compileQuery(
      compilerDb.selectFrom('user').fullJoin('post', 'user.id', 'post.userId').selectAll('user'),
    );
    const fullResult = transformKyselyToPnAst(
      contract,
      fullCompiled.query,
      fullCompiled.parameters,
    );
    expect((fullResult.ast as SelectAst).joins?.[0]?.joinType).toBe('full');
  });

  it('expands SelectionNode-wrapped ReferenceNode(column: SelectAllNode)', () => {
    const compiled = compileQuery(
      compilerDb
        .selectFrom('user as u')
        .innerJoin('post as p', 'u.id', 'p.userId')
        .selectAll('u')
        .orderBy('p.createdAt', 'desc'),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const selectAst = result.ast as SelectAst;

    expect(selectAst.project).toEqual([
      { alias: 'createdAt', expr: { kind: 'col', table: 'user', column: 'createdAt' } },
      { alias: 'email', expr: { kind: 'col', table: 'user', column: 'email' } },
      { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
    ]);
    expect(selectAst.selectAllIntent).toEqual({ table: 'user' });
    expect(selectAst.orderBy?.[0]).toMatchObject({
      expr: { kind: 'col', table: 'post', column: 'createdAt' },
      dir: 'desc',
    });
  });

  it('transforms numeric limit node from compiled query', () => {
    const compiled = compileQuery(
      compilerDb.selectFrom('user').select(['id', 'email']).where('id', '=', 'u_1').limit(10),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const selectAst = result.ast as SelectAst;

    expect(selectAst.limit).toBe(10);
    expect(result.metaAdditions.paramDescriptors).toHaveLength(1);
  });
});
