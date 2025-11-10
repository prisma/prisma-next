import { createColumnRef, createParamRef } from '@prisma-next/sql-relational-core/ast';
import type {
  BinaryExpr,
  ColumnRef,
  Direction,
  IncludeAst,
  SelectAst,
} from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';

describe('Include AST types', () => {
  it('defines IncludeAst with includeMany kind', () => {
    const includeAst: IncludeAst = {
      kind: 'includeMany',
      alias: 'posts',
      child: {
        table: { kind: 'table', name: 'post' },
        on: {
          kind: 'eqCol',
          left: createColumnRef('user', 'id'),
          right: createColumnRef('post', 'userId'),
        },
        project: [
          { alias: 'id', expr: createColumnRef('post', 'id') },
          { alias: 'title', expr: createColumnRef('post', 'title') },
        ],
      },
    };

    expect(includeAst.kind).toBe('includeMany');
    expect(includeAst.alias).toBe('posts');
    expect(includeAst.child.table.name).toBe('post');
    expect(includeAst.child.on.kind).toBe('eqCol');
    expect(includeAst.child.project.length).toBe(2);
  });

  it('defines IncludeAst with optional where clause', () => {
    const whereExpr: BinaryExpr = {
      kind: 'bin',
      op: 'eq',
      left: createColumnRef('post', 'published'),
      right: createParamRef(1, 'published'),
    };

    const includeAst: IncludeAst = {
      kind: 'includeMany',
      alias: 'posts',
      child: {
        table: { kind: 'table', name: 'post' },
        on: {
          kind: 'eqCol',
          left: createColumnRef('user', 'id'),
          right: createColumnRef('post', 'userId'),
        },
        where: whereExpr,
        project: [{ alias: 'id', expr: createColumnRef('post', 'id') }],
      },
    };

    expect(includeAst.child.where).toBeDefined();
    expect(includeAst.child.where?.kind).toBe('bin');
  });

  it('defines IncludeAst with optional orderBy clause', () => {
    const orderBy: ReadonlyArray<{ expr: ColumnRef; dir: Direction }> = [
      { expr: createColumnRef('post', 'createdAt'), dir: 'desc' },
    ];

    const includeAst: IncludeAst = {
      kind: 'includeMany',
      alias: 'posts',
      child: {
        table: { kind: 'table', name: 'post' },
        on: {
          kind: 'eqCol',
          left: createColumnRef('user', 'id'),
          right: createColumnRef('post', 'userId'),
        },
        orderBy,
        project: [{ alias: 'id', expr: createColumnRef('post', 'id') }],
      },
    };

    expect(includeAst.child.orderBy).toBeDefined();
    expect(includeAst.child.orderBy?.length).toBe(1);
    expect(includeAst.child.orderBy?.[0]?.dir).toBe('desc');
  });

  it('defines IncludeAst with optional limit', () => {
    const includeAst: IncludeAst = {
      kind: 'includeMany',
      alias: 'posts',
      child: {
        table: { kind: 'table', name: 'post' },
        on: {
          kind: 'eqCol',
          left: createColumnRef('user', 'id'),
          right: createColumnRef('post', 'userId'),
        },
        limit: 10,
        project: [{ alias: 'id', expr: createColumnRef('post', 'id') }],
      },
    };

    expect(includeAst.child.limit).toBe(10);
  });

  it('defines SelectAst with optional includes array', () => {
    const selectAst: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      includes: [
        {
          kind: 'includeMany',
          alias: 'posts',
          child: {
            table: { kind: 'table', name: 'post' },
            on: {
              kind: 'eqCol',
              left: createColumnRef('user', 'id'),
              right: createColumnRef('post', 'userId'),
            },
            project: [{ alias: 'id', expr: createColumnRef('post', 'id') }],
          },
        },
      ],
      project: [
        { alias: 'id', expr: createColumnRef('user', 'id') },
        { alias: 'posts', expr: { kind: 'includeRef', alias: 'posts' } },
      ],
    };

    expect(selectAst.includes).toBeDefined();
    expect(selectAst.includes?.length).toBe(1);
    expect(selectAst.includes?.[0]?.kind).toBe('includeMany');
    expect(selectAst.includes?.[0]?.alias).toBe('posts');
  });

  it('allows SelectAst without includes', () => {
    const selectAst: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [{ alias: 'id', expr: createColumnRef('user', 'id') }],
    };

    expect(selectAst.includes).toBeUndefined();
  });

  it('supports includeRef in projection expressions', () => {
    const selectAst: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [
        { alias: 'id', expr: createColumnRef('user', 'id') },
        { alias: 'posts', expr: { kind: 'includeRef', alias: 'posts' } },
      ],
    };

    const postsProjection = selectAst.project.find((p) => p.alias === 'posts');
    expect(postsProjection).toBeDefined();
    if (postsProjection && 'kind' in postsProjection.expr) {
      expect(postsProjection.expr.kind).toBe('includeRef');
      if (postsProjection.expr.kind === 'includeRef') {
        expect(postsProjection.expr.alias).toBe('posts');
      }
    }
  });
});
