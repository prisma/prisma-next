import type { JoinAst, JoinOnExpr, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';

describe('Join AST types', () => {
  it('defines JoinOnExpr with eqCol kind', () => {
    const onExpr: JoinOnExpr = {
      kind: 'eqCol',
      left: createColumnRef('user', 'id'),
      right: createColumnRef('post', 'userId'),
    };

    expect(onExpr.kind).toBe('eqCol');
    expect(onExpr.left.table).toBe('user');
    expect(onExpr.left.column).toBe('id');
    expect(onExpr.right.table).toBe('post');
    expect(onExpr.right.column).toBe('userId');
  });

  it('defines JoinAst with join type and table', () => {
    const joinAst: JoinAst = {
      kind: 'join',
      joinType: 'inner',
      table: { kind: 'table', name: 'post' },
      on: {
        kind: 'eqCol',
        left: createColumnRef('user', 'id'),
        right: createColumnRef('post', 'userId'),
      },
    };

    expect(joinAst.kind).toBe('join');
    expect(joinAst.joinType).toBe('inner');
    expect(joinAst.table.name).toBe('post');
    expect(joinAst.on.kind).toBe('eqCol');
  });

  it('defines SelectAst with optional joins array', () => {
    const selectAst: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      joins: [
        {
          kind: 'join',
          joinType: 'inner',
          table: { kind: 'table', name: 'post' },
          on: {
            kind: 'eqCol',
            left: createColumnRef('user', 'id'),
            right: createColumnRef('post', 'userId'),
          },
        },
      ],
      project: [{ alias: 'id', expr: createColumnRef('user', 'id') }],
    };

    expect(selectAst.joins).toBeDefined();
    expect(selectAst.joins?.length).toBe(1);
    expect(selectAst.joins?.[0]?.joinType).toBe('inner');
  });

  it('allows SelectAst without joins', () => {
    const selectAst: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'id', expr: createColumnRef('user', 'id') }],
    };

    expect(selectAst.joins).toBeUndefined();
  });

  it('supports all join types', () => {
    const joinTypes: Array<'inner' | 'left' | 'right' | 'full'> = [
      'inner',
      'left',
      'right',
      'full',
    ];

    for (const joinType of joinTypes) {
      const joinAst: JoinAst = {
        kind: 'join',
        joinType,
        table: { kind: 'table', name: 'post' },
        on: {
          kind: 'eqCol',
          left: createColumnRef('user', 'id'),
          right: createColumnRef('post', 'userId'),
        },
      };

      expect(joinAst.joinType).toBe(joinType);
    }
  });
});
