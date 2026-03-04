import { describe, expect, it } from 'vitest';
import {
  createDeleteAstBuilder,
  createInsertAstBuilder,
  createInsertOnConflictAstBuilder,
  createSelectAstBuilder,
  createUpdateAstBuilder,
  doNothing,
  doUpdateSet,
} from '../../src/ast/builders';
import {
  createColumnRef,
  createDefaultValueExpr,
  createParamRef,
  createTableRef,
} from '../../src/ast/common';
import { createBinaryExpr } from '../../src/ast/predicate';

describe('ast/builders', () => {
  it('builds select ast with fluent low-level builder', () => {
    const userTable = createTableRef('user');
    const idExpr = createColumnRef('user', 'id');
    const emailExpr = createColumnRef('user', 'email');
    const where = createBinaryExpr('eq', idExpr, createParamRef(1, 'id'));

    const ast = createSelectAstBuilder(userTable)
      .project([{ alias: 'id', expr: idExpr }])
      .where(where)
      .orderBy([{ expr: idExpr, dir: 'asc' }])
      .distinct()
      .distinctOn([emailExpr])
      .groupBy([idExpr])
      .having(createBinaryExpr('gt', idExpr, createParamRef(2, 'minId')))
      .limit(10)
      .offset(5)
      .build();

    expect(ast.kind).toBe('select');
    expect(ast.from).toEqual(userTable);
    expect(ast.project).toEqual([{ alias: 'id', expr: idExpr }]);
    expect(ast.where).toEqual(where);
    expect(ast.distinct).toBe(true);
    expect(ast.distinctOn).toEqual([emailExpr]);
    expect(ast.groupBy).toEqual([idExpr]);
    expect(ast.limit).toBe(10);
    expect(ast.offset).toBe(5);
  });

  it('builds insert ast with onConflict update set', () => {
    const table = createTableRef('user');
    const onConflict = createInsertOnConflictAstBuilder([createColumnRef('user', 'id')])
      .doUpdateSet({ email: createParamRef(3, 'email') })
      .build();
    const ast = createInsertAstBuilder(table)
      .values({
        id: createParamRef(1, 'id'),
        email: createParamRef(2, 'email'),
      })
      .onConflict(onConflict)
      .returning([createColumnRef('user', 'id')])
      .build();

    expect(ast.kind).toBe('insert');
    expect(ast.onConflict).toEqual({
      columns: [createColumnRef('user', 'id')],
      action: doUpdateSet({ email: createParamRef(3, 'email') }),
    });
  });

  it('builds insert ast with onConflict doNothing', () => {
    const table = createTableRef('user');
    const onConflict = createInsertOnConflictAstBuilder([createColumnRef('user', 'id')])
      .doNothing()
      .build();
    const ast = createInsertAstBuilder(table)
      .values({
        id: createParamRef(1, 'id'),
      })
      .onConflict(onConflict)
      .build();

    expect(ast.onConflict).toEqual({
      columns: [createColumnRef('user', 'id')],
      action: doNothing(),
    });
  });

  it('builds insert ast with explicit rows and default cells', () => {
    const table = createTableRef('user');
    const ast = createInsertAstBuilder(table)
      .rows([
        {
          id: createParamRef(1, 'id'),
          email: createParamRef(2, 'email'),
        },
        {
          id: createParamRef(3, 'id2'),
          email: createDefaultValueExpr(),
        },
      ])
      .build();

    expect(ast.rows).toEqual([
      {
        id: createParamRef(1, 'id'),
        email: createParamRef(2, 'email'),
      },
      {
        id: createParamRef(3, 'id2'),
        email: createDefaultValueExpr(),
      },
    ]);
  });

  it('preserves explicit empty insert rows', () => {
    const table = createTableRef('user');
    const ast = createInsertAstBuilder(table).rows([]).build();

    expect(ast.rows).toEqual([]);
  });

  it('builds update and delete ast', () => {
    const where = createBinaryExpr('eq', createColumnRef('user', 'id'), createParamRef(1, 'id'));
    const updateAst = createUpdateAstBuilder(createTableRef('user'))
      .set({ email: createParamRef(2, 'email') })
      .where(where)
      .returning([createColumnRef('user', 'id')])
      .build();
    const deleteAst = createDeleteAstBuilder(createTableRef('user'))
      .where(where)
      .returning([createColumnRef('user', 'id')])
      .build();

    expect(updateAst.kind).toBe('update');
    expect(deleteAst.kind).toBe('delete');
    expect(updateAst.where).toEqual(where);
    expect(deleteAst.where).toEqual(where);
  });
});
