import { describe, expect, it } from 'vitest';
import type { SelectAst, IncludeAst, BinaryExpr, ColumnRef, Direction } from '../src/types';

describe('Include AST types', () => {
  it('defines IncludeAst with includeMany kind', () => {
    const includeAst: IncludeAst = {
      kind: 'includeMany',
      alias: 'posts',
      child: {
        table: { kind: 'table', name: 'post' },
        on: {
          kind: 'eqCol',
          left: { kind: 'col', table: 'user', column: 'id' },
          right: { kind: 'col', table: 'post', column: 'userId' },
        },
        project: [
          { alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } },
          { alias: 'title', expr: { kind: 'col', table: 'post', column: 'title' } },
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
      left: { kind: 'col', table: 'post', column: 'published' },
      right: { kind: 'param', index: 1, name: 'published' },
    };

    const includeAst: IncludeAst = {
      kind: 'includeMany',
      alias: 'posts',
      child: {
        table: { kind: 'table', name: 'post' },
        on: {
          kind: 'eqCol',
          left: { kind: 'col', table: 'user', column: 'id' },
          right: { kind: 'col', table: 'post', column: 'userId' },
        },
        where: whereExpr,
        project: [{ alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } }],
      },
    };

    expect(includeAst.child.where).toBeDefined();
    expect(includeAst.child.where?.kind).toBe('bin');
  });

  it('defines IncludeAst with optional orderBy clause', () => {
    const orderBy: ReadonlyArray<{ expr: ColumnRef; dir: Direction }> = [
      { expr: { kind: 'col', table: 'post', column: 'createdAt' }, dir: 'desc' },
    ];

    const includeAst: IncludeAst = {
      kind: 'includeMany',
      alias: 'posts',
      child: {
        table: { kind: 'table', name: 'post' },
        on: {
          kind: 'eqCol',
          left: { kind: 'col', table: 'user', column: 'id' },
          right: { kind: 'col', table: 'post', column: 'userId' },
        },
        orderBy,
        project: [{ alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } }],
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
          left: { kind: 'col', table: 'user', column: 'id' },
          right: { kind: 'col', table: 'post', column: 'userId' },
        },
        limit: 10,
        project: [{ alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } }],
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
              left: { kind: 'col', table: 'user', column: 'id' },
              right: { kind: 'col', table: 'post', column: 'userId' },
            },
            project: [{ alias: 'id', expr: { kind: 'col', table: 'post', column: 'id' } }],
          },
        },
      ],
      project: [
        { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
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
      project: [{ alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } }],
    };

    expect(selectAst.includes).toBeUndefined();
  });

  it('supports includeRef in projection expressions', () => {
    const selectAst: SelectAst = {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [
        { alias: 'id', expr: { kind: 'col', table: 'user', column: 'id' } },
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

